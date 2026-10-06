from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import nbformat
from playwright.sync_api import sync_playwright
import pytest

TOKEN = "e2e-test-token"
REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class NbclassicServer:
    port: int
    notebook_dir: Path

    def open_notebook(self, page, cells, metadata=None):
        """Write ``cells`` to a new notebook, open it in ``page``, and wait for a live kernel."""
        notebook = nbformat.v4.new_notebook(cells=cells, metadata=metadata or {})
        name = f"{os.urandom(4).hex()}.ipynb"
        nbformat.write(notebook, self.notebook_dir / name)

        page.goto(f"http://localhost:{self.port}/notebooks/{name}?token={TOKEN}")
        page.wait_for_function(
            "() => { var k = window.Jupyter && Jupyter.notebook && Jupyter.notebook.kernel;"
            " return !!k && k.is_connected() && !!k.info_reply; }",
            timeout=45000,
        )

    def shut_down_sessions(self):
        """Delete every notebook session, shutting down its kernel."""
        sessions_url = f"http://localhost:{self.port}/api/sessions"
        with urllib.request.urlopen(f"{sessions_url}?token={TOKEN}") as response:
            sessions = json.loads(response.read())
        for session in sessions:
            request = urllib.request.Request(
                f"{sessions_url}/{session['id']}?token={TOKEN}", method="DELETE"
            )
            urllib.request.urlopen(request).close()


def free_port():
    """Return an OS-assigned free TCP port."""
    with socket.socket() as sock:
        sock.bind(("", 0))
        return sock.getsockname()[1]


def wait_until_up(port, timeout, log_path):
    """Block until the Jupyter server on ``port`` answers ``/api/status``; raise with its log if not."""
    deadline = time.time() + timeout
    url = f"http://localhost:{port}/api/status?token={TOKEN}"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return
        except OSError:
            time.sleep(0.3)
    raise RuntimeError(f"nbclassic on port {port} did not come up:\n{log_path.read_text()}")


def jupyter_home_serving_the_repo(home):
    """Build Jupyter config and data dirs that serve and enable the working tree's nbextensions.

    An install copies ``static/`` into the environment, so without this a browser runs whatever JS
    was current when the environment was built.
    """
    config_dir = home / "config"
    data_dir = home / "data"
    shutil.copytree(REPO_ROOT / "static", data_dir / "nbextensions")
    shutil.copytree(REPO_ROOT / "jupyter-config", config_dir / "nbconfig")
    return config_dir, data_dir


@pytest.fixture(scope="session")
def nbclassic_server(tmp_path_factory):
    """Run a real nbclassic server serving this repo's nbextensions; yield its handle."""
    port = free_port()
    notebook_dir = tmp_path_factory.mktemp("notebooks")
    config_dir, data_dir = jupyter_home_serving_the_repo(tmp_path_factory.mktemp("jupyter_home"))
    log_path = tmp_path_factory.mktemp("logs") / "nbclassic.log"
    with log_path.open("w") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "jupyter", "nbclassic", "--port", str(port), "--no-browser"],
            cwd=notebook_dir,
            env={
                **os.environ,
                "JUPYTER_TOKEN": TOKEN,
                "JUPYTER_CONFIG_DIR": str(config_dir),
                "JUPYTER_DATA_DIR": str(data_dir),
            },
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            wait_until_up(port, timeout=40, log_path=log_path)
            yield NbclassicServer(port=port, notebook_dir=notebook_dir)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture
def page(browser, nbclassic_server):
    page = browser.new_page()
    yield page
    page.close()
    nbclassic_server.shut_down_sessions()

import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path

import pytest

from nbclassic_extras.gist import GhError, gh_api, gist_body

FAKE_GH = Path(__file__).resolve().parents[1] / "fake_gh"


@pytest.fixture
def fake_gh(tmp_path, monkeypatch):
    """Put the fake gh first on PATH and return a function that sets its replies."""
    monkeypatch.setenv("PATH", f"{FAKE_GH}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_GH_DIR", str(tmp_path))

    def reply(replies):
        (tmp_path / "replies.json").write_text(json.dumps(replies))

    reply.calls = lambda: [
        json.loads(line) for line in (tmp_path / "calls.jsonl").read_text().splitlines()
    ]
    return reply


def call(method, path, body=None):
    # a fresh thread, since Playwright's sync API keeps an event loop running on the main thread
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, gh_api(method=method, path=path, body=body)).result()


def test_gh_api_sends_the_body_on_stdin_and_returns_the_decoded_reply(fake_gh):
    fake_gh({"POST /gists": {"stdout": {"id": "abc123"}}})

    assert call("POST", "/gists", {"description": "Talk"}) == {"id": "abc123"}
    assert fake_gh.calls() == [
        {"method": "POST", "path": "/gists", "body": {"description": "Talk"}}
    ]


def test_an_http_error_carries_githubs_status_and_message(fake_gh):
    fake_gh({})

    with pytest.raises(GhError) as error:
        call("GET", "/gists/abc123/commits")

    assert error.value.status == 404
    assert error.value.message == "GitHub answered 404: Not Found"


def test_a_validation_error_lists_the_reasons_github_gives(fake_gh):
    validation = {
        "message": "Validation Failed",
        "errors": [
            {"resource": "Gist", "field": "files", "code": "custom", "message": "too large"},
            {"resource": "Gist", "field": "description", "code": "invalid"},
        ],
    }
    fake_gh(
        {
            "POST /gists": {
                "exit": 1,
                "stdout": validation,
                "stderr": "gh: Validation Failed (HTTP 422)",
            }
        }
    )

    with pytest.raises(GhError) as error:
        call("POST", "/gists", {})

    assert error.value.status == 422
    assert error.value.message == (
        "GitHub answered 422: Validation Failed (too large; description: invalid)"
    )


def test_a_logged_out_gh_asks_for_gh_auth_login(fake_gh):
    fake_gh({"GET /user": {"exit": 4, "stderr": "To get started with GitHub CLI, please run: ..."}})

    with pytest.raises(GhError) as error:
        call("GET", "/user")

    assert error.value.status == 401
    assert "gh auth login" in error.value.message


def test_a_failure_without_an_http_status_reports_what_gh_said(fake_gh):
    fake_gh({"GET /user": {"exit": 1, "stderr": "error connecting to api.github.com"}})

    with pytest.raises(GhError) as error:
        call("GET", "/user")

    assert error.value.status == 502
    assert error.value.message == "error connecting to api.github.com"


def test_a_server_without_gh_says_so(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))

    with pytest.raises(GhError) as error:
        call("GET", "/user")

    assert error.value.status == 503
    assert "not installed" in error.value.message


def test_a_new_gist_holds_only_the_notebook_its_description_and_visibility():
    request = {
        "description": "Talk",
        "public": True,
        "filename": "talk.ipynb",
        "content": "{}",
        "files": {"other.txt": None},
    }

    assert gist_body(request) == {
        "description": "Talk",
        "public": True,
        "files": {"talk.ipynb": {"content": "{}"}},
    }


def test_an_update_leaves_visibility_alone_and_drops_a_renamed_notebooks_old_file():
    request = {
        "id": "abc123",
        "description": "Talk",
        "public": True,
        "filename": "new.ipynb",
        "previous_filename": "old.ipynb",
        "content": "{}",
    }

    assert gist_body(request) == {
        "description": "Talk",
        "files": {"new.ipynb": {"content": "{}"}, "old.ipynb": None},
    }

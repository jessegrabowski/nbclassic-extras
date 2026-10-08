import asyncio
import json
import re
import shutil
from typing import Any

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web

GIST_ID = re.compile(r"[0-9a-f]+", re.IGNORECASE)
GH_TIMEOUT_SECONDS = 60
# the exit status gh uses when it has no GitHub login
GH_NOT_LOGGED_IN = 4


class GhError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


async def gh_api(method: str, path: str, body: dict | None = None) -> Any:
    """Call GitHub's API as the GitHub CLI's logged-in user and return the decoded response."""
    if shutil.which("gh") is None:
        raise GhError(503, "The GitHub CLI (gh) is not installed on the Jupyter server.")
    command = ["gh", "api", "--method", method, path]
    if body is not None:
        command += ["--input", "-"]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdin = None if body is None else json.dumps(body).encode()
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(stdin), timeout=GH_TIMEOUT_SECONDS
        )
    except TimeoutError:
        process.kill()
        raise GhError(504, "GitHub did not answer in time.") from None
    if process.returncode == GH_NOT_LOGGED_IN:
        raise GhError(
            401, "The GitHub CLI on the Jupyter server is not logged in. Run gh auth login there."
        )
    if process.returncode != 0:
        raise github_error(stdout=stdout, stderr=stderr)
    return json.loads(stdout) if stdout.strip() else None


def github_error(stdout: bytes, stderr: bytes) -> GhError:
    """Turn a failed ``gh api`` call into the HTTP status and message GitHub gave."""
    http_status = re.search(rb"\(HTTP (\d+)\)", stderr)
    message = github_message(stdout)
    if http_status is None:
        return GhError(502, message or stderr.decode().strip() or "The GitHub CLI failed.")
    status = int(http_status.group(1))
    return GhError(status, f"GitHub answered {status}: {message or 'no message'}")


def github_message(stdout: bytes) -> str | None:
    """Return GitHub's error message followed by the reasons it lists, or None for no message."""
    try:
        reply = json.loads(stdout)
    except ValueError:
        return None
    if not isinstance(reply, dict) or not reply.get("message"):
        return None
    # a 422 says only "Validation Failed" and puts the reasons in "errors"
    reasons = [validation_reason(error) for error in reply.get("errors") or []]
    if not reasons:
        return reply["message"]
    return f"{reply['message']} ({'; '.join(reasons)})"


def validation_reason(error: object) -> str:
    """Describe one entry of GitHub's ``errors`` list, which is a string or a field and code."""
    if not isinstance(error, dict):
        return str(error)
    return error.get("message") or f"{error.get('field')}: {error.get('code')}"


def gist_body(request: dict) -> dict:
    """Build GitHub's gist request from the notebook fields the extension sends, and nothing else.

    A gist updated after the notebook was renamed drops the file of its previous name.
    """
    filename = request["filename"]
    description = str(request.get("description", ""))
    files: dict[str, dict | None] = {filename: {"content": request["content"]}}
    if not request.get("id"):
        return {"description": description, "files": files, "public": bool(request.get("public"))}
    previous = request.get("previous_filename")
    if previous and previous != filename:
        files[previous] = None
    return {"description": description, "files": files}


class GhHandler(APIHandler):
    async def call_gh(self, method: str, path: str, body: dict | None = None) -> Any:
        try:
            return await gh_api(method=method, path=path, body=body)
        except GhError as error:
            raise web.HTTPError(error.status, error.message) from None


class AccountHandler(GhHandler):
    @web.authenticated
    async def get(self):
        user = await self.call_gh("GET", "/user")
        self.finish(json.dumps({"login": user["login"]}))


class GistCommitsHandler(GhHandler):
    @web.authenticated
    async def get(self, gist_id: str):
        commits = await self.call_gh("GET", f"/gists/{gist_id}/commits")
        self.finish(json.dumps({"revisions": len(commits)}))


class GistsHandler(GhHandler):
    @web.authenticated
    async def post(self):
        request = self.get_json_body() or {}
        gist_id = request.get("id") or ""
        if gist_id and not GIST_ID.fullmatch(gist_id):
            raise web.HTTPError(400, "A gist id is made of the letters a-f and digits only.")
        filename, content = request.get("filename"), request.get("content")
        if not isinstance(filename, str) or not isinstance(content, str):
            raise web.HTTPError(400, "A gist needs the notebook's filename and content.")
        path = f"/gists/{gist_id}" if gist_id else "/gists"
        gist = await self.call_gh("PATCH" if gist_id else "POST", path, gist_body(request))
        self.finish(
            json.dumps(
                {
                    "id": gist["id"],
                    "html_url": gist["html_url"],
                    "revisions": len(gist.get("history", [])),
                }
            )
        )


def _load_jupyter_server_extension(serverapp):
    base_url = serverapp.web_app.settings["base_url"]
    serverapp.web_app.add_handlers(
        ".*$",
        [
            (url_path_join(base_url, "gist_it/account"), AccountHandler),
            (url_path_join(base_url, r"gist_it/gists/([0-9a-fA-F]+)/commits"), GistCommitsHandler),
            (url_path_join(base_url, "gist_it/gists"), GistsHandler),
        ],
    )

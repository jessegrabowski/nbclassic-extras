import json
import urllib.error
import urllib.request

from playwright.sync_api import expect
import pytest
from slideshow import markdown

GIST_BUTTON = "[data-jupyter-action='gist_it:create-gist-from-notebook']"
LOGGED_IN = {"GET /user": {"stdout": {"login": "octocat"}}}


def test_gist_it_adds_its_toolbar_button(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "")])

    expect(page.locator(f"{GIST_BUTTON} .fa-github")).to_be_visible()


def test_the_server_refuses_a_gist_id_that_is_not_hex_without_calling_gh(nbclassic_server):
    request = urllib.request.Request(
        nbclassic_server.url("gist_it/gists"),
        data=json.dumps(
            {"id": "../../user/repos", "filename": "talk.ipynb", "content": "{}"}
        ).encode(),
        method="POST",
    )

    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(request)

    assert error.value.code == 400
    assert nbclassic_server.gh_calls() == []


def test_a_logged_out_gh_tells_the_user_to_log_in(nbclassic_server, page):
    nbclassic_server.reply_from_gh(
        {"GET /user": {"exit": 4, "stderr": "please run: gh auth login"}}
    )
    nbclassic_server.open_notebook(page, [markdown("Alpha", "")])

    page.click(GIST_BUTTON)

    expect(page.locator("#gist_account")).to_contain_text("Run gh auth login there.")


def test_publishing_creates_the_gist_through_gh_and_links_it(nbclassic_server, page):
    gist = {"id": "abc123", "html_url": "https://gist.github.com/abc123", "history": [{}]}
    nbclassic_server.reply_from_gh(
        {
            **LOGGED_IN,
            "POST /gists": {"stdout": gist},
            # the dialog checks the new gist once it is published
            "GET /gists/abc123/commits": {"stdout": [{}]},
        }
    )
    name = nbclassic_server.open_notebook(page, [markdown("Alpha", "")])

    page.click(GIST_BUTTON)
    expect(page.locator("#gist_account")).to_have_text("Publishing as octocat.")
    page.click("#gist_modal .btn-primary")

    link = page.locator("#gist_result a")
    expect(link).to_have_text("abc123")
    expect(link).to_have_attribute("href", "https://gist.github.com/abc123")
    expect(page.locator("#gist_id_status")).to_contain_text("it has 1 revision so far")
    assert page.evaluate("() => Jupyter.notebook.metadata.gist.id") == "abc123"

    [create] = [call for call in nbclassic_server.gh_calls() if call["method"] == "POST"]
    assert create["path"] == "/gists"
    assert create["body"]["public"] is False
    assert json.loads(create["body"]["files"][name]["content"])["cells"][0]["source"] == "Alpha"

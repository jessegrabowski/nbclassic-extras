import json

from playwright.sync_api import expect
from slideshow import markdown

GIST_BUTTON = "[data-jupyter-action='gist_it:create-gist-from-notebook']"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
}


def test_gist_it_adds_its_toolbar_button(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "")])

    expect(page.locator(f"{GIST_BUTTON} .fa-github")).to_be_visible()


def test_publishing_posts_the_notebook_to_the_gist_api_and_links_the_gist(nbclassic_server, page):
    nbclassic_server.patch_nbconfig("notebook", {"gist_it_personal_access_token": "fake-token"})
    try:
        requests = []

        def reply_with_a_gist(route):
            requests.append(route.request)
            gist = {"id": "abc123", "html_url": "https://gist.github.com/abc123", "history": [{}]}
            route.fulfill(status=201, headers=CORS, json=gist)

        page.route("https://api.github.com/gists", reply_with_a_gist)
        name = nbclassic_server.open_notebook(page, [markdown("Alpha", "")])

        page.click(GIST_BUTTON)
        page.click("#gist_modal .btn-primary")

        link = page.locator("#gist_modal .alert-success a")
        expect(link).to_have_text("abc123")
        expect(link).to_have_attribute("href", "https://gist.github.com/abc123")
    finally:
        nbclassic_server.patch_nbconfig("notebook", {"gist_it_personal_access_token": None})

    [request] = requests
    assert request.method == "POST"
    assert request.headers["authorization"] == "token fake-token"
    content = json.loads(request.post_data)["files"][name]["content"]
    assert json.loads(content)["cells"][0]["source"] == "Alpha"

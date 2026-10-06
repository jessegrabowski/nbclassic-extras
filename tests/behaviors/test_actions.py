from playwright.sync_api import expect
from slideshow import RISE_ENABLED, markdown


def test_alt_r_enters_and_exits_the_slideshow(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])

    page.keyboard.press("Alt+r")
    expect(page.locator("body")).to_have_class(RISE_ENABLED)
    page.wait_for_function("() => location.hash.startsWith('#/slide-')")

    page.keyboard.press("Alt+r")
    expect(page.locator("body")).not_to_have_class(RISE_ENABLED)

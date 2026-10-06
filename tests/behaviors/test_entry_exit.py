from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, exit_slideshow, markdown


def test_rise_button_enters_and_exits_slideshow(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])

    enter_slideshow(page)
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Alpha")

    exit_slideshow(page)
    expect(page.locator("#notebook-container section")).to_have_count(0)

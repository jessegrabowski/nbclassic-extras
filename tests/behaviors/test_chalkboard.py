from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown


def test_chalkboard_toggle_opens_the_board(nbclassic_server, page):
    nbclassic_server.open_notebook(
        page,
        [markdown("Alpha", "slide")],
        metadata={"rise": {"enable_chalkboard": True}},
    )
    enter_slideshow(page)
    board = page.locator("#chalkboard")
    expect(board).to_be_hidden()

    page.click("#toggle-chalkboard")
    expect(board).to_be_visible()

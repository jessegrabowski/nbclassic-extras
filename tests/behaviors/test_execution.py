from nbformat.v4 import new_code_cell
from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow


def test_shift_enter_in_slideshow_runs_cell_and_shows_output(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [new_code_cell("print(6 * 7)")])
    enter_slideshow(page)

    page.locator(CURRENT_SUBSLIDE).locator(".CodeMirror").click()
    page.keyboard.press("Shift+Enter")

    expect(page.locator(CURRENT_SUBSLIDE).locator(".output_area")).to_contain_text("42")

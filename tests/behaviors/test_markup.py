from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown


def test_skip_and_notes_cells_are_hidden_in_slideshow(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Skipped", "skip"),
        markdown("Spoken", "notes"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)

    rendered = page.locator(".text_cell_render")
    expect(rendered.filter(has_text="Alpha")).to_be_visible()
    expect(rendered.filter(has_text="Skipped")).to_be_hidden()
    expect(page.locator("aside.notes")).to_contain_text("Spoken")
    expect(rendered.filter(has_text="Spoken")).to_be_hidden()

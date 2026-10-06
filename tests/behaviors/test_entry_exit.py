from nbformat.v4 import new_code_cell
from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, exit_slideshow, markdown


def test_rise_button_enters_and_exits_slideshow(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])

    enter_slideshow(page)
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Alpha")

    exit_slideshow(page)
    expect(page.locator("#notebook-container section")).to_have_count(0)


def test_exit_restores_cell_order_and_editing(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Skipped", "skip"),
        markdown("Spoken", "notes"),
        new_code_cell("x = 1", metadata={"slideshow": {"slide_type": "fragment"}}),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    exit_slideshow(page)

    restored = page.locator("#notebook-container > .cell")
    expect(restored).to_have_count(4)
    expect(restored.nth(0)).to_contain_text("Alpha")
    expect(restored.nth(1)).to_contain_text("Skipped")
    expect(restored.nth(2)).to_contain_text("Spoken")
    expect(restored.nth(3)).to_contain_text("x = 1")
    expect(restored.nth(1)).to_be_visible()

    restored.nth(3).locator(".CodeMirror").click()
    page.keyboard.press("End")
    page.keyboard.type("0")
    expect(restored.nth(3)).to_contain_text("x = 10")


def test_exit_keeps_notebook_order_when_notes_follow_a_fragment(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Bravo", "fragment"),
        markdown("Spoken", "notes"),
        markdown("Charlie", "-"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    exit_slideshow(page)

    order = page.evaluate("() => Jupyter.notebook.get_cells().map((cell) => cell.get_text())")
    assert order == ["Alpha", "Bravo", "Spoken", "Charlie"]

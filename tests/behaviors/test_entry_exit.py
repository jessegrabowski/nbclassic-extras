from nbformat.v4 import new_code_cell
from playwright.sync_api import expect
from slideshow import (
    CURRENT_SUBSLIDE,
    enter_slideshow,
    exit_slideshow,
    has_class,
    markdown,
)


def test_slideshow_hides_skip_and_notes_cells_and_exit_restores_them(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Skipped", "skip"),
        markdown("Spoken", "notes"),
        new_code_cell("x = 1", metadata={"slideshow": {"slide_type": "fragment"}}),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    rendered = page.locator(".text_cell_render")
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Alpha")
    expect(rendered.filter(has_text="Skipped")).to_be_hidden()
    expect(page.locator("aside.notes")).to_contain_text("Spoken")
    expect(rendered.filter(has_text="Spoken")).to_be_hidden()

    exit_slideshow(page)

    expect(page.locator("#notebook-container section")).to_have_count(0)
    restored = page.locator("#notebook-container > .cell")
    expect(restored).to_have_count(4)
    expect(restored.nth(0)).to_contain_text("Alpha")
    expect(restored.nth(1)).to_contain_text("Skipped")
    expect(restored.nth(2)).to_contain_text("Spoken")
    expect(restored.nth(3)).to_contain_text("x = 1")
    expect(restored.nth(1)).to_be_visible()
    expect(page.locator(".reveal-skip")).to_have_count(0)

    restored.nth(3).locator(".CodeMirror").click()
    page.keyboard.press("End")
    page.keyboard.type("0")
    expect(restored.nth(3)).to_contain_text("x = 10")


def test_slash_toggles_the_pause_overlay_after_reentering(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)
    exit_slideshow(page)
    enter_slideshow(page)
    reveal = page.locator("div.reveal")

    page.keyboard.press("/")
    expect(reveal).to_have_class(has_class("paused"))
    expect(page.locator(".pause-overlay")).to_be_visible()

    page.keyboard.press("/")
    expect(reveal).not_to_have_class(has_class("paused"))


def test_exiting_right_after_entering_leaves_the_notebook_unsized(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide"), markdown("Bravo", "slide")])
    enter_slideshow(page)
    exit_slideshow(page)
    page.wait_for_timeout(1000)

    container = page.locator("#notebook-container")
    assert (container.get_attribute("style") or "").strip() == ""


def test_s_saves_the_notebook_again_after_exiting(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)
    exit_slideshow(page)

    page.evaluate(
        "() => { window.notebookSaved = new Promise((resolve) =>"
        " Jupyter.notebook.events.one('notebook_saved.Notebook', resolve)); }"
    )
    page.keyboard.press("Escape")
    page.keyboard.press("s")

    saved = page.evaluate(
        "() => Promise.race([window.notebookSaved.then(() => true),"
        " new Promise((resolve) => setTimeout(() => resolve(false), 5000))])"
    )
    assert saved


def test_exit_restores_the_shortcuts_behind_custom_reveal_keys(nbclassic_server, page):
    # "a,b" is refused while "a" is bound on its own, "g,u" starts with an unbound key, and "i"
    # begins nbclassic's "i,i"
    custom = {"lastSlide": "a,b", "toggleOverview": "g,u", "firstSlide": "i"}
    metadata = {"rise": {"reveal_shortcuts": {"main": custom}}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    exit_slideshow(page)

    expect(page.locator("#exit_b")).to_have_count(0)
    shortcut = "(key) => Jupyter.keyboard_manager.command_shortcuts.get_shortcut(key)"
    assert page.evaluate(shortcut, "a") == "jupyter-notebook:insert-cell-above"
    assert page.evaluate(shortcut, "shift-enter") == "jupyter-notebook:run-cell-and-select-next"
    assert page.evaluate(shortcut, "g") is None
    assert page.evaluate(shortcut, "i,i") == "jupyter-notebook:interrupt-kernel"

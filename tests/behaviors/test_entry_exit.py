import re

from nbformat.v4 import new_code_cell, new_output
from playwright.sync_api import expect
from slideshow import (
    CURRENT_SUBSLIDE,
    code,
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


def test_returning_to_the_tab_keeps_the_cell_editor_focused_in_and_after_the_slideshow(
    nbclassic_server, page
):
    nbclassic_server.open_notebook(page, [code("x = 1", "slide")])
    editor = page.locator(".CodeMirror")
    editor_focused = "() => document.activeElement.closest('.CodeMirror') !== null"
    return_to_tab = "() => document.dispatchEvent(new Event('visibilitychange'))"

    enter_slideshow(page)
    editor.click()
    page.evaluate(return_to_tab)
    assert page.evaluate(editor_focused)

    exit_slideshow(page)
    editor.click()
    page.evaluate(return_to_tab)
    assert page.evaluate(editor_focused)


def test_exiting_a_scaled_slideshow_leaves_the_notebook_unscaled(nbclassic_server, page):
    metadata = {"rise": {"width": 3000, "height": 2000, "minScale": 0.1}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    container = page.locator("#notebook-container")
    expect(container).to_have_attribute("style", re.compile("transform"))

    exit_slideshow(page)

    assert (container.get_attribute("style") or "").strip() == ""


def test_a_cell_div_inside_an_output_is_not_counted_as_a_notebook_cell(nbclassic_server, page):
    html = new_output("display_data", data={"text/html": '<div class="cell">Inner</div>'})
    cells = [markdown("Alpha", "slide"), new_code_cell("x = 1", outputs=[html])]
    nbclassic_server.open_notebook(page, cells)
    expect(page.locator(".output .cell")).to_have_count(1)

    assert page.evaluate("() => Jupyter.notebook.ncells()") == 2
    enter_slideshow(page)
    exit_slideshow(page)
    assert page.evaluate("() => Jupyter.notebook.ncells()") == 2


def test_the_pointer_stays_visible_over_the_notebook_after_exit(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)
    page.clock.install()
    page.mouse.move(400, 300)
    exit_slideshow(page)

    # longer than reveal's hideCursorTime
    page.clock.run_for(6000)

    assert page.evaluate("() => document.getElementById('notebook').style.cursor") == ""

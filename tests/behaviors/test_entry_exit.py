from nbformat.v4 import new_code_cell
from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, RISE_ENABLED, enter_slideshow, exit_slideshow, markdown


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
    expect(page.locator(".reveal-skip")).to_have_count(0)

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


def test_pause_overlay_works_after_reentering(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)
    exit_slideshow(page)
    enter_slideshow(page)

    page.keyboard.press("/")

    expect(page.locator(".pause-overlay")).to_be_visible()


def test_reentering_keeps_every_rise_button_hidden_when_startup_hides_them(nbclassic_server, page):
    metadata = {"rise": {"show_buttons_on_startup": False, "enable_chalkboard": True}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    expect(page.locator("#toggle-chalkboard")).to_be_hidden(timeout=5000)
    page.keyboard.press("Alt+r")
    expect(page.locator("body")).not_to_have_class(RISE_ENABLED)
    enter_slideshow(page)
    page.wait_for_timeout(3000)

    expect(page.locator("#exit_b")).to_be_hidden()
    expect(page.locator("#toggle-chalkboard")).to_be_hidden()


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


def test_exit_restores_two_key_shortcuts_under_a_custom_reveal_key(nbclassic_server, page):
    metadata = {"rise": {"reveal_shortcuts": {"main": {"toggleOverview": "i"}}}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    exit_slideshow(page)

    expect(page.locator("#exit_b")).to_have_count(0)
    shortcut = "() => Jupyter.keyboard_manager.command_shortcuts.get_shortcut('i,i')"
    assert page.evaluate(shortcut) == "jupyter-notebook:interrupt-kernel"


def test_custom_reveal_keys_that_nbclassic_cannot_bind_leave_exit_working(nbclassic_server, page):
    # "a,b" is refused while "a" is bound on its own, and "g,u" starts with an unbound key
    custom = {"lastSlide": "a,b", "toggleOverview": "g,u"}
    metadata = {"rise": {"reveal_shortcuts": {"main": custom}}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    exit_slideshow(page)

    expect(page.locator("#exit_b")).to_have_count(0)
    shortcut = "(key) => Jupyter.keyboard_manager.command_shortcuts.get_shortcut(key)"
    assert page.evaluate(shortcut, "a") == "jupyter-notebook:insert-cell-above"
    assert page.evaluate(shortcut, "shift-enter") == "jupyter-notebook:run-cell-and-select-next"
    assert page.evaluate(shortcut, "g") is None

from nbformat.v4 import new_code_cell
from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, code, enter_slideshow, exit_slideshow, markdown

# Short enough that waiting a second leaves no doubt the auto-select hook has run.
AUTO_SELECT_TIMEOUT = 100


def selected_cell_text(page):
    return page.locator(".cell.selected .input_area")


def test_shift_enter_in_slideshow_runs_cell_and_shows_output(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [new_code_cell("print(6 * 7)")], wait_for_kernel=True)
    enter_slideshow(page)
    expect(selected_cell_text(page)).to_contain_text("print(6 * 7)")

    page.locator(CURRENT_SUBSLIDE).locator(".CodeMirror").click()
    page.keyboard.press("Shift+Enter")

    expect(page.locator(CURRENT_SUBSLIDE).locator(".output_area")).to_contain_text("42")


def test_shift_enter_moves_to_the_next_cell_on_the_same_slide(nbclassic_server, page):
    cells = [code("print('first')", "slide"), code("print('second')")]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    enter_slideshow(page)
    expect(selected_cell_text(page)).to_contain_text("print('first')")

    page.locator(".cell").nth(0).locator(".CodeMirror").click()
    page.keyboard.press("Shift+Enter")

    expect(page.locator(".cell").nth(0).locator(".output_area")).to_contain_text("first")
    expect(selected_cell_text(page)).to_contain_text("print('second')")


def test_shift_enter_on_the_last_cell_of_a_slide_stays_on_that_cell(nbclassic_server, page):
    cells = [code("print('first')", "slide"), code("print('second')", "slide")]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    enter_slideshow(page)
    expect(selected_cell_text(page)).to_contain_text("print('first')")

    page.locator(".cell").nth(0).locator(".CodeMirror").click()
    page.keyboard.press("Shift+Enter")

    expect(page.locator(".cell").nth(0).locator(".output_area")).to_contain_text("first")
    expect(selected_cell_text(page)).to_contain_text("print('first')")
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("print('first')")


def test_shift_enter_moves_into_the_next_fragment_only_once_it_is_shown(nbclassic_server, page):
    cells = [code("print('first')", "slide"), code("print('second')", "fragment")]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    enter_slideshow(page)
    expect(selected_cell_text(page)).to_contain_text("print('first')")
    first = page.locator(".cell").nth(0).locator(".CodeMirror")

    first.click()
    page.keyboard.press("Shift+Enter")
    expect(page.locator(".cell").nth(0).locator(".output_area")).to_contain_text("first")
    expect(selected_cell_text(page)).to_contain_text("print('first')")

    page.keyboard.press("Escape")
    page.keyboard.press("Space")
    first.click()
    page.keyboard.press("Shift+Enter")
    expect(selected_cell_text(page)).to_contain_text("print('second')")


def test_shift_enter_on_a_cell_added_during_the_slideshow_moves_on(nbclassic_server, page):
    cells = [code("print('first')", "slide"), code("print('last')")]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    enter_slideshow(page)
    expect(selected_cell_text(page)).to_contain_text("print('first')")

    page.keyboard.press("b")
    page.keyboard.press("Enter")
    page.keyboard.type("print('added')")
    page.keyboard.press("Shift+Enter")

    expect(page.locator(".cell").nth(1).locator(".output_area")).to_contain_text("added")
    expect(selected_cell_text(page)).to_contain_text("print('last')")


def test_auto_select_code_selects_the_first_code_cell_of_the_slide(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), code("x = 1"), markdown("Bravo", "slide"), code("y = 2")]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)

    page.keyboard.press("Space")

    expect(selected_cell_text(page)).to_contain_text("y = 2")


def test_auto_select_first_selects_the_first_cell_of_any_type(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), code("x = 1"), markdown("Bravo", "slide"), code("y = 2")]
    nbclassic_server.open_notebook(page, cells, metadata={"rise": {"auto_select": "first"}})
    enter_slideshow(page)

    page.keyboard.press("Space")

    expect(page.locator(".cell.selected")).to_contain_text("Bravo")


def test_auto_select_none_leaves_no_cell_selected(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), code("x = 1"), markdown("Bravo", "slide"), code("y = 2")]
    metadata = {"rise": {"auto_select": "none", "auto_select_timeout": AUTO_SELECT_TIMEOUT}}
    nbclassic_server.open_notebook(page, cells, metadata=metadata)
    enter_slideshow(page)

    page.keyboard.press("Space")
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Bravo")
    page.wait_for_timeout(10 * AUTO_SELECT_TIMEOUT)

    expect(page.locator(".cell.selected")).to_have_count(0)


def test_auto_select_fragment_selects_the_code_cell_of_the_shown_fragment(nbclassic_server, page):
    cells = [code("x = 1", "slide"), code("y = 2", "fragment")]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)

    page.keyboard.press("Space")

    expect(selected_cell_text(page)).to_contain_text("y = 2")


def test_auto_select_fragment_off_keeps_the_first_code_cell_of_the_slide(nbclassic_server, page):
    cells = [code("x = 1", "slide"), code("y = 2", "fragment")]
    metadata = {"rise": {"auto_select_fragment": False, "auto_select_timeout": AUTO_SELECT_TIMEOUT}}
    nbclassic_server.open_notebook(page, cells, metadata=metadata)
    enter_slideshow(page)

    page.keyboard.press("Space")
    expect(page.locator(".fragment.visible")).to_contain_text("y = 2")
    page.wait_for_timeout(10 * AUTO_SELECT_TIMEOUT)

    expect(selected_cell_text(page)).to_contain_text("x = 1")


def test_new_output_that_overflows_the_slide_makes_it_scrollable(nbclassic_server, page):
    cells = [code("for line in range(80):\n    print(line)", "slide")]
    nbclassic_server.open_notebook(
        page, cells, metadata={"rise": {"scroll": True}}, wait_for_kernel=True
    )
    enter_slideshow(page)
    expect(page.locator(CURRENT_SUBSLIDE)).not_to_have_css("overflow-y", "scroll")
    expect(selected_cell_text(page)).to_contain_text("for line")

    page.locator(".cell").nth(0).locator(".CodeMirror").click()
    page.keyboard.press("Shift+Enter")

    expect(page.locator(CURRENT_SUBSLIDE)).to_have_css("overflow-y", "scroll")


def test_output_of_a_cell_added_during_the_slideshow_can_make_the_slide_scrollable(
    nbclassic_server, page
):
    cells = [code("x = 1", "slide")]
    nbclassic_server.open_notebook(
        page, cells, metadata={"rise": {"scroll": True}}, wait_for_kernel=True
    )
    enter_slideshow(page)
    expect(page.locator(CURRENT_SUBSLIDE)).not_to_have_css("overflow-y", "scroll")

    page.keyboard.press("b")
    page.keyboard.press("Enter")
    page.keyboard.type("print('\\n'.join(map(str, range(80))))")
    page.keyboard.press("Shift+Enter")

    expect(page.locator(CURRENT_SUBSLIDE)).to_have_css("overflow-y", "scroll")


def test_exit_selects_the_first_cell_of_the_slide_being_shown(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), code("x = 1"), markdown("Bravo", "slide"), code("y = 2")]
    nbclassic_server.open_notebook(page, cells, metadata={"rise": {"auto_select": "none"}})
    enter_slideshow(page)
    page.keyboard.press("Space")
    expect(page.locator(".cell.selected")).to_have_count(0)

    exit_slideshow(page)

    expect(page.locator(".cell.selected")).to_contain_text("Bravo")

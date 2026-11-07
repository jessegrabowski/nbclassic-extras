from nbformat.v4 import new_output
from playwright.sync_api import expect
from slideshow import code, markdown


def run_action(page, name):
    # nbextensions load after the notebook reports itself loaded
    page.wait_for_function(
        "(name) => Jupyter.keyboard_manager.actions.exists(`cell_folds:${name}`)", arg=name
    )
    page.evaluate("(name) => Jupyter.keyboard_manager.actions.call(`cell_folds:${name}`)", name)


def code_with_output(source):
    cell = code(source)
    cell.outputs = [new_output("stream", name="stdout", text=f"{source} output\n")]
    return cell


def folded_input(page, index):
    return page.evaluate(
        "(index) => Jupyter.notebook.get_cell(index).element.hasClass('input_folded')", index
    )


def test_a_folded_input_hides_the_editor_and_keeps_the_prompt_and_output(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first"), code("second")])
    page.evaluate("() => Jupyter.notebook.select(0)")

    run_action(page, "fold-input-of-selected")

    first = page.locator(".code_cell").nth(0)
    expect(first.locator(".inner_cell")).to_be_hidden()
    expect(first.locator(".input_prompt")).to_be_visible()
    expect(first.locator(".output_area")).to_contain_text("first output")
    expect(page.locator(".code_cell").nth(1).locator(".inner_cell")).to_be_visible()


def test_entering_edit_mode_reveals_a_folded_input_and_takes_typing(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("first"), code("second")])
    page.evaluate("() => Jupyter.notebook.select(0)")
    run_action(page, "fold-input-of-selected")

    page.evaluate("() => Jupyter.notebook.edit_mode()")
    page.keyboard.type("typed ")

    expect(page.locator(".code_cell").nth(0).locator(".inner_cell")).to_be_visible()
    assert page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()") == "typed first"


def test_folding_an_input_in_edit_mode_leaves_edit_mode(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("first")])
    page.evaluate("() => { Jupyter.notebook.select(0); Jupyter.notebook.edit_mode(); }")

    run_action(page, "fold-input-of-selected")

    assert page.evaluate("() => Jupyter.notebook.mode") == "command"


def test_a_joint_fold_hides_input_and_output(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first"), code("second")])
    page.evaluate("() => Jupyter.notebook.select(0)")

    run_action(page, "fold-joint-of-selected")

    first = page.locator(".code_cell").nth(0)
    expect(first.locator(".inner_cell")).to_be_hidden()
    expect(first.locator(".output_area")).to_be_hidden()

    run_action(page, "unfold-joint-of-selected")

    expect(first.locator(".inner_cell")).to_be_visible()
    expect(first.locator(".output_area")).to_be_visible()


def test_the_reading_view_hides_cells_whose_output_is_folded(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", ""), code_with_output("first")])

    run_action(page, "fold-joint-of-all")

    expect(page.locator(".text_cell")).to_contain_text("Alpha")
    expect(page.locator(".code_cell")).to_be_hidden()

    run_action(page, "unfold-joint-of-all")

    expect(page.locator(".code_cell")).to_be_visible()


def test_the_reading_view_shows_markdown_and_outputs_only(nbclassic_server, page):
    nbclassic_server.open_notebook(
        page, [markdown("Alpha", ""), code_with_output("first"), code("no output")]
    )

    run_action(page, "fold-input-of-all")

    expect(page.locator(".text_cell")).to_contain_text("Alpha")
    expect(page.locator(".text_cell .prompt")).to_be_hidden()
    expect(page.locator(".code_cell").nth(0).locator(".input")).to_be_hidden()
    expect(page.locator(".code_cell").nth(0).locator(".output_area")).to_contain_text(
        "first output"
    )
    expect(page.locator(".code_cell").nth(0).locator(".output_area .prompt")).to_be_hidden()
    expect(page.locator(".code_cell").nth(1)).to_be_hidden()

    run_action(page, "unfold-input-of-all")

    expect(page.locator(".code_cell").nth(1)).to_be_visible()


def test_running_a_folded_cell_keeps_it_folded_and_shows_its_output(nbclassic_server, page):
    nbclassic_server.open_notebook(
        page, [code("print('fresh')"), code("second")], wait_for_kernel=True
    )
    page.evaluate("() => Jupyter.notebook.select(0)")
    run_action(page, "fold-input-of-selected")

    page.keyboard.press("Shift+Enter")

    expect(page.locator(".output_area")).to_contain_text("fresh")
    assert folded_input(page, 0)
    assert page.evaluate("() => Jupyter.notebook.get_selected_index()") == 1

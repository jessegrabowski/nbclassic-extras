from nbformat.v4 import new_output
from playwright.sync_api import expect
import pytest
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


def press_on_second_of_two_cells(page, key):
    # nbextensions load after the notebook reports itself loaded
    page.wait_for_function(
        "() => ['shift-;', 'alt-shift-minus'].some((shortcut) =>"
        " Jupyter.keyboard_manager.command_shortcuts.get_shortcut(shortcut) !== undefined)"
    )
    page.evaluate("() => { Jupyter.notebook.select(1); Jupyter.notebook.command_mode(); }")
    page.keyboard.press(key)


SEPARATE_KEYS = [
    pytest.param("Minus", "Equal", True, False, id="input"),
    pytest.param("BracketLeft", "BracketRight", False, True, id="output"),
    pytest.param("Semicolon", "Quote", True, True, id="joint"),
]
CHORD_KEYS = [
    pytest.param("ControlOrMeta+Minus", "ControlOrMeta+Equal", True, False, id="input"),
    pytest.param("Alt+Minus", "Alt+Equal", False, True, id="output"),
    pytest.param("ControlOrMeta+Alt+Minus", "ControlOrMeta+Alt+Equal", True, True, id="joint"),
]


def folded_input(page, index):
    return page.evaluate(
        "(index) => Jupyter.notebook.get_cell(index).element.hasClass('input_folded')", index
    )


def collapsed_output(page, index):
    return page.evaluate("(index) => Jupyter.notebook.get_cell(index).output_area.collapsed", index)


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


def test_a_folded_output_leaves_no_expand_button(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first")])
    page.evaluate("() => Jupyter.notebook.select(0)")

    run_action(page, "fold-output-of-selected")

    expect(page.locator(".output_area")).to_be_hidden()
    expect(page.locator(".output_collapsed")).to_be_hidden()


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


def test_a_saved_collapsed_output_shows_no_button_and_reopens_by_key(nbclassic_server, page):
    cell = code_with_output("first")
    cell.metadata["collapsed"] = True
    nbclassic_server.open_notebook(page, [code("second"), cell])
    collapsed = page.locator(".code_cell").nth(1)

    expect(collapsed.locator(".output_area")).to_be_hidden()
    expect(collapsed.locator(".output_collapsed")).to_be_hidden()

    press_on_second_of_two_cells(page, "BracketRight")

    expect(collapsed.locator(".output_area")).to_contain_text("first output")


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


@pytest.mark.parametrize(("fold", "unfold", "input_folds", "output_folds"), SEPARATE_KEYS)
def test_separate_keys_fold_and_unfold_the_selected_cell(
    nbclassic_server, page, fold, unfold, input_folds, output_folds
):
    nbclassic_server.open_notebook(page, [code("first"), code_with_output("second")])

    press_on_second_of_two_cells(page, fold)

    assert folded_input(page, 1) == input_folds
    assert collapsed_output(page, 1) == output_folds
    assert not folded_input(page, 0)

    page.keyboard.press(unfold)

    assert not folded_input(page, 1)
    assert not collapsed_output(page, 1)


@pytest.mark.parametrize(("fold", "unfold", "input_folds", "output_folds"), SEPARATE_KEYS)
def test_shift_with_a_separate_key_folds_every_cell(
    nbclassic_server, page, fold, unfold, input_folds, output_folds
):
    nbclassic_server.open_notebook(page, [code("first"), code_with_output("second")])

    press_on_second_of_two_cells(page, f"Shift+{fold}")

    assert folded_input(page, 0) == input_folds
    assert collapsed_output(page, 0) == output_folds
    assert folded_input(page, 1) == input_folds
    assert collapsed_output(page, 1) == output_folds

    page.keyboard.press(f"Shift+{unfold}")

    assert not folded_input(page, 0)
    assert not collapsed_output(page, 0)


@pytest.mark.parametrize(("fold", "unfold", "input_folds", "output_folds"), CHORD_KEYS)
def test_chords_fold_and_unfold_the_selected_cell(
    nbclassic_server, page, fold, unfold, input_folds, output_folds
):
    nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": "chords"})
    try:
        nbclassic_server.open_notebook(page, [code("first"), code_with_output("second")])

        press_on_second_of_two_cells(page, fold)

        assert folded_input(page, 1) == input_folds
        assert collapsed_output(page, 1) == output_folds
        assert not folded_input(page, 0)

        page.keyboard.press(unfold)

        assert not folded_input(page, 1)
        assert not collapsed_output(page, 1)
    finally:
        nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": None})


def test_chord_system_leaves_the_separate_keys_unbound(nbclassic_server, page):
    nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": "chords"})
    try:
        nbclassic_server.open_notebook(page, [code("first"), code("second")])

        press_on_second_of_two_cells(page, "Minus")

        assert not folded_input(page, 1)
    finally:
        nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": None})


def test_shift_with_a_chord_folds_every_cell(nbclassic_server, page):
    nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": "chords"})
    try:
        nbclassic_server.open_notebook(page, [code("first"), code("second")])

        press_on_second_of_two_cells(page, "ControlOrMeta+Shift+Minus")

        assert folded_input(page, 0)
        assert folded_input(page, 1)
    finally:
        nbclassic_server.patch_nbconfig("notebook", {"cell_folds_key_system": None})

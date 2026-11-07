import nbformat
from nbformat.v4 import new_output
from playwright.sync_api import expect
import pytest
from slideshow import code, has_class, markdown


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


FUNCTION_THEN_STATEMENT = "def f():\n    a = 1\n    b = 2\n\nc = 3"


def edit_at_line(page, line):
    # nbextensions load after the notebook reports itself loaded
    page.wait_for_function(
        "() => ['meta-minus', 'ctrl-minus'].some((shortcut) =>"
        " Jupyter.keyboard_manager.edit_shortcuts.get_shortcut(shortcut) !== undefined)"
    )
    page.evaluate(
        """(line) => {
            Jupyter.notebook.select(0);
            Jupyter.notebook.edit_mode();
            Jupyter.notebook.get_cell(0).code_mirror.setCursor({line: line, ch: 0});
        }""",
        line,
    )


def folded_block_lines(page):
    return page.evaluate(
        """() => Jupyter.notebook.get_cell(0).code_mirror.getAllMarks()
            .filter((mark) => mark.__isFold)
            .map((mark) => [mark.find().from.line, mark.find().to.line])"""
    )


def folded_block_count(page):
    return page.evaluate(
        "() => Jupyter.notebook.get_cell(0).code_mirror.getAllMarks()"
        ".filter((mark) => mark.__isFold).length"
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


def test_edit_mode_keys_fold_and_unfold_the_block_around_the_cursor(nbclassic_server, page):
    # the kernel sets the editor's language mode, which block folding must work under
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)], wait_for_kernel=True)
    edit_at_line(page, 1)

    page.keyboard.press("ControlOrMeta+Minus")

    assert folded_block_count(page) == 1
    expect(page.locator(".CodeMirror-foldmarker")).to_have_text("...")
    expect(page.locator(".CodeMirror-code")).not_to_contain_text("b = 2")
    text = page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()")
    assert text == FUNCTION_THEN_STATEMENT
    assert page.evaluate("() => Jupyter.notebook.mode") == "edit"

    page.keyboard.press("ControlOrMeta+Equal")

    assert folded_block_count(page) == 0
    expect(page.locator(".CodeMirror-code")).to_contain_text("b = 2")


def test_a_second_fold_of_the_same_block_changes_nothing(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)

    page.keyboard.press("ControlOrMeta+Minus")
    page.keyboard.press("ControlOrMeta+Minus")

    assert folded_block_count(page) == 1


def test_editing_after_a_fold_changes_the_visible_header_only(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    page.keyboard.press("Backspace")
    page.keyboard.type(": # note")

    expected = FUNCTION_THEN_STATEMENT.replace("def f():", "def f(): # note")
    assert page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()") == expected
    assert folded_block_count(page) == 1


@pytest.mark.parametrize(
    "keys",
    [["ArrowRight", "Backspace"], ["Delete"], ["ArrowRight", "ControlOrMeta+Backspace"]],
    ids=["backspace_after_the_fold", "delete_before_the_fold", "line_delete_after_the_fold"],
)
def test_deleting_beside_a_fold_unfolds_it_and_keeps_the_text(nbclassic_server, page, keys):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    for key in keys:
        page.keyboard.press(key)

    expect(page.locator(".CodeMirror-foldmarker")).to_have_count(0)
    text = page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()")
    assert text == FUNCTION_THEN_STATEMENT


def test_undoing_a_paste_that_is_folded_removes_it_and_keeps_the_undo_history(
    nbclassic_server, page
):
    nbclassic_server.open_notebook(page, [code("x = 1\ndef f():")])
    edit_at_line(page, 1)
    page.evaluate(
        """() => {
            const editor = Jupyter.notebook.get_cell(0).code_mirror;
            editor.replaceRange("\\n    a\\n    b", {line: 1, ch: 8}, undefined, "paste");
            editor.setCursor({line: 2, ch: 0});
        }"""
    )
    page.keyboard.press("ControlOrMeta+Minus")
    undo_steps = page.evaluate("() => Jupyter.notebook.get_cell(0).code_mirror.historySize().undo")

    page.keyboard.press("ControlOrMeta+z")

    assert page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()") == "x = 1\ndef f():"
    assert (
        page.evaluate("() => Jupyter.notebook.get_cell(0).code_mirror.historySize().undo")
        == undo_steps - 1
    )


def test_setting_a_cell_text_replaces_a_folded_block(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    page.evaluate("() => Jupyter.notebook.get_cell(0).set_text('')")

    assert page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()") == ""


def test_deleting_a_selection_around_a_fold_deletes_it(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.press("Backspace")

    assert page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()") == ""


@pytest.mark.parametrize(
    ("cursor_line", "folded_lines"),
    [
        pytest.param(2, [1, 3], id="inner_body_folds_the_inner_block"),
        pytest.param(1, [1, 3], id="inner_header_folds_the_inner_block"),
        pytest.param(4, [0, 4], id="line_after_the_inner_block_folds_the_outer_block"),
        pytest.param(0, [0, 4], id="outer_header_folds_the_outer_block"),
    ],
)
def test_the_fold_takes_the_innermost_block_around_the_cursor(
    nbclassic_server, page, cursor_line, folded_lines
):
    source = "def f():\n    if a:\n        b\n        c\n    d\n\ne"
    nbclassic_server.open_notebook(page, [code(source)])
    edit_at_line(page, cursor_line)

    page.keyboard.press("ControlOrMeta+Minus")

    assert folded_block_lines(page) == [folded_lines]


def test_unfolding_one_block_leaves_the_others_folded(nbclassic_server, page):
    source = "def f():\n    a\n    b\n\ndef g():\n    c\n    d"
    nbclassic_server.open_notebook(page, [code(source)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")
    edit_at_line(page, 5)
    page.keyboard.press("ControlOrMeta+Minus")

    page.keyboard.press("ControlOrMeta+Equal")

    assert folded_block_lines(page) == [[0, 2]]


def test_a_line_outside_any_block_folds_nothing(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 4)

    page.keyboard.press("ControlOrMeta+Minus")

    assert folded_block_count(page) == 0


def test_clicks_and_arrow_keys_leave_a_folded_block_folded(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 0)
    page.keyboard.press("ControlOrMeta+Minus")

    marker = page.locator(".CodeMirror-foldmarker").bounding_box()
    page.mouse.click(marker["x"] + marker["width"] / 2, marker["y"] + marker["height"] / 2)
    page.keyboard.press("End")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowDown")

    assert folded_block_count(page) == 1


@pytest.mark.parametrize(
    ("edge", "command"),
    [("from", "deleteLine"), ("to", "deleteLine"), ("from", "killLine")],
)
def test_line_deletes_at_a_fold_edge_unfold_it_and_keep_the_text(
    nbclassic_server, page, edge, command
):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    page.evaluate(
        """([edge, command]) => {
            const editor = Jupyter.notebook.get_cell(0).code_mirror;
            const fold = editor.getAllMarks().find((mark) => mark.__isFold).find();
            editor.setCursor(fold[edge]);
            editor.execCommand(command);
        }""",
        [edge, command],
    )

    expect(page.locator(".CodeMirror-foldmarker")).to_have_count(0)
    text = page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()")
    assert text == FUNCTION_THEN_STATEMENT


def test_cutting_with_no_selection_beside_a_fold_unfolds_it_and_keeps_the_text(
    nbclassic_server, page
):
    nbclassic_server.open_notebook(page, [code(FUNCTION_THEN_STATEMENT)])
    edit_at_line(page, 1)
    page.keyboard.press("ControlOrMeta+Minus")

    page.evaluate(
        """() => {
            const input = Jupyter.notebook.get_cell(0).code_mirror.getInputField();
            input.dispatchEvent(new ClipboardEvent("cut", {bubbles: true, cancelable: true}));
        }"""
    )

    expect(page.locator(".CodeMirror-foldmarker")).to_have_count(0)
    text = page.evaluate("() => Jupyter.notebook.get_cell(0).get_text()")
    assert text == FUNCTION_THEN_STATEMENT


def test_block_folds_also_work_in_markdown_cells(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("- a\n    - b\n    - c", "")])
    edit_at_line(page, 1)

    page.keyboard.press("ControlOrMeta+Minus")

    assert folded_block_lines(page) == [[0, 2]]


def test_double_clicking_an_output_prompt_does_not_fold_it(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first")])
    page.wait_for_function("() => Jupyter.keyboard_manager.actions.exists('cell_folds:fold-block')")

    page.locator(".out_prompt_overlay").dblclick(force=True)

    assert not collapsed_output(page, 0)


def test_o_leaves_no_expand_button(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("first"), code_with_output("second")])

    press_on_second_of_two_cells(page, "o")

    assert collapsed_output(page, 1)
    expect(page.locator(".code_cell").nth(1).locator(".output_collapsed")).to_be_hidden()


def test_saving_keeps_output_folds_and_drops_input_folds(nbclassic_server, page):
    name = nbclassic_server.open_notebook(page, [code("first"), code_with_output("second")])
    press_on_second_of_two_cells(page, "Semicolon")

    page.evaluate("() => Jupyter.notebook.save_notebook()")

    saved = nbformat.read(nbclassic_server.notebook_dir / name, as_version=4)
    assert saved.cells[1].metadata["collapsed"] is True

    page.reload()
    page.wait_for_function(
        "() => !!(window.Jupyter && Jupyter.notebook && Jupyter.notebook._fully_loaded)"
    )

    assert collapsed_output(page, 1)
    assert not folded_input(page, 1)


def test_inserting_a_cell_leaves_the_reading_view(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first")])
    run_action(page, "fold-input-of-all")
    expect(page.locator("body")).to_have_class(has_class("outputs_only"))

    page.evaluate("() => Jupyter.notebook.insert_cell_below('code')")

    expect(page.locator("body")).not_to_have_class(has_class("outputs_only"))


@pytest.mark.parametrize(
    "structural_change",
    [
        "Jupyter.notebook.delete_cell(1)",
        "Jupyter.notebook.select(1); Jupyter.notebook.cells_to_markdown()",
    ],
    ids=["deleting_it", "making_it_markdown"],
)
def test_removing_the_last_unfolded_code_cell_enters_the_reading_view(
    nbclassic_server, page, structural_change
):
    nbclassic_server.open_notebook(page, [code_with_output("first"), code("second")])
    page.evaluate("() => Jupyter.notebook.select(0)")
    run_action(page, "fold-input-of-selected")
    expect(page.locator("body")).not_to_have_class(has_class("outputs_only"))

    page.evaluate(f"() => {{ {structural_change} }}")

    expect(page.locator("body")).to_have_class(has_class("outputs_only"))


def test_the_reading_view_keeps_the_selected_cell_visible(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code_with_output("first"), code("no output")])
    run_action(page, "fold-input-of-all")
    no_output = page.locator(".code_cell").nth(1)
    expect(no_output).to_be_hidden()

    page.evaluate("() => Jupyter.notebook.select(1)")

    expect(no_output).to_be_visible()


def test_running_a_cell_with_a_folded_output_shows_the_new_output(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("print('fresh')")], wait_for_kernel=True)
    page.evaluate("() => Jupyter.notebook.select(0)")
    run_action(page, "fold-output-of-selected")

    page.evaluate("() => Jupyter.notebook.execute_cells([0])")

    expect(page.locator(".output_area")).to_contain_text("fresh")
    assert not collapsed_output(page, 0)


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

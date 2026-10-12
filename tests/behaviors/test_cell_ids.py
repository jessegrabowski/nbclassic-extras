from playwright.sync_api import expect
from slideshow import code, markdown


def shown_indices(page):
    return page.evaluate(
        "() => Jupyter.notebook.get_cells()"
        ".map((cell) => cell.element.find('div.input_prompt').attr('data-cell-index'))"
    )


def test_a_run_cell_shows_its_index_above_its_execution_count(nbclassic_server, page):
    nbclassic_server.open_notebook(
        page, [markdown("Alpha", ""), code("1 + 1")], wait_for_kernel=True
    )

    page.evaluate("() => Jupyter.notebook.execute_cells([1])")

    expect(page.locator(".code_cell .input_prompt > .cell_run")).to_have_text("In\xa0[1]:")
    assert shown_indices(page) == ["0", "1"]


def test_inserting_and_moving_cells_renumbers_every_prompt(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", ""), code("1"), code("2")])
    page.wait_for_function("() => $('div.input_prompt[data-cell-index]').length === 3")

    page.evaluate("() => Jupyter.notebook.insert_cell_above('code', 0).set_text('0')")
    # nbclassic fires no event for a move
    page.evaluate("() => { Jupyter.notebook.select(1); Jupyter.notebook.move_selection_down(); }")

    page.wait_for_function(
        "() => Jupyter.notebook.get_cell(2).element.find('div.input_prompt')"
        ".attr('data-cell-index') === '2'"
    )
    assert page.evaluate("() => Jupyter.notebook.get_cell(2).cell_type") == "markdown"
    assert shown_indices(page) == ["0", "1", "2", "3"]

from nbformat.v4 import new_output
from playwright.sync_api import expect
import pytest
from slideshow import code

RED_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
RED_SQUARE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
    '<rect width="16" height="16" fill="#ff0000"/></svg>'
)


def button(page, action):
    return page.locator(f"button[data-jupyter-action='cell_dashboard:{action}']")


def open_dashboard(page):
    with page.expect_popup() as popup:
        button(page, "open-dashboard").click()
    return popup.value


def run_cell(page, index):
    page.evaluate(f"() => Jupyter.notebook.execute_cells([{index}])")


def test_a_sent_cell_shows_its_title_and_output(nbclassic_server, page):
    cell = code("print('one')\nprint('two')")
    cell.outputs = [new_output("stream", name="stdout", text="one\ntwo\n")]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    expect(dashboard.locator("#pane_title")).to_contain_text("Send a cell")

    button(page, "send-cell-to-dashboard").click()

    expect(dashboard.locator("#pane_title")).to_have_text("print('one')")
    expect(dashboard.locator("#pane_outputs pre")).to_have_text("one\ntwo\n")


def test_a_cell_sent_before_the_window_opens_appears_when_it_does(nbclassic_server, page):
    cell = code("a = 1")
    cell.outputs = [new_output("stream", name="stdout", text="early\n")]
    nbclassic_server.open_notebook(page, [cell])
    button(page, "send-cell-to-dashboard").click()

    dashboard = open_dashboard(page)

    expect(dashboard.locator("#pane_outputs pre")).to_have_text("early\n")


def test_a_reloaded_window_gets_its_cell_back(nbclassic_server, page):
    cell = code("a = 1")
    cell.outputs = [new_output("stream", name="stdout", text="kept\n")]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()
    expect(dashboard.locator("#pane_outputs pre")).to_have_text("kept\n")

    dashboard.reload()

    expect(dashboard.locator("#pane_outputs pre")).to_have_text("kept\n")


def test_opening_twice_reuses_the_window(nbclassic_server, page):
    cell = code("a = 1")
    cell.outputs = [new_output("stream", name="stdout", text="kept\n")]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    with dashboard.expect_navigation():
        button(page, "open-dashboard").click()

    assert len(page.context.pages) == 2
    expect(dashboard.locator("#pane_outputs pre")).to_have_text("kept\n")


@pytest.mark.parametrize(
    "data",
    [{"image/png": RED_PIXEL_PNG}, {"image/svg+xml": RED_SQUARE_SVG}],
    ids=["png", "svg"],
)
def test_an_image_stretches_to_fill_the_window(nbclassic_server, page, data):
    cell = code("plot")
    cell.outputs = [new_output("display_data", data=data)]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 800, "height": 600})

    button(page, "send-cell-to-dashboard").click()

    image = dashboard.locator("#pane_outputs img")
    expect(image).to_be_visible()
    dashboard.wait_for_function(
        "() => document.querySelector('#pane_outputs img').naturalWidth > 0"
    )
    box = image.bounding_box()
    assert box["width"] > 700
    assert box["height"] > 450


def test_running_a_linked_cell_refreshes_its_pane(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("print('one')")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()
    run_cell(page, 0)
    expect(dashboard.locator("#pane_outputs pre")).to_have_text("one\n")

    page.evaluate("() => Jupyter.notebook.get_cell(0).set_text(\"print('two')\")")
    run_cell(page, 0)

    expect(dashboard.locator("#pane_outputs pre")).to_have_text("two\n")
    expect(dashboard.locator("#pane_title")).to_have_text("print('two')")


def test_a_stream_shows_what_its_carriage_returns_left(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(r"print('old text\rnew')")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator("#pane_outputs pre")).to_have_text("new text\n")


def test_a_failed_run_shows_its_traceback(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("1 / 0")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator("#pane_outputs pre")).to_contain_text("ZeroDivisionError")
    expect(dashboard.locator("#pane_outputs pre")).not_to_contain_text("\x1b")


def test_a_table_from_a_run_shows_as_a_table(nbclassic_server, page):
    source = "from IPython.display import HTML\nHTML('<table><tr><td>value</td></tr></table>')"
    nbclassic_server.open_notebook(page, [code(source)], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator("#pane_outputs td")).to_have_text("value")


def test_html_saved_in_an_untrusted_notebook_shows_as_text(nbclassic_server, page):
    cell = code("frame")
    cell.outputs = [
        new_output(
            "execute_result",
            data={"text/html": "<table><tr><td>value</td></tr></table>", "text/plain": "frame"},
        )
    ]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)

    button(page, "send-cell-to-dashboard").click()

    expect(dashboard.locator("#pane_outputs pre")).to_have_text("frame")
    expect(dashboard.locator("#pane_outputs td")).to_have_count(0)

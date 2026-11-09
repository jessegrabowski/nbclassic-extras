import re

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
    """Open the dashboard from the command palette's action, as nothing has been sent yet."""
    with page.expect_popup() as popup:
        call_open_action(page)
    return popup.value


def call_open_action(page):
    action = "cell_dashboard:open-dashboard"
    # extensions register their actions after the notebook loads
    page.wait_for_function(f"() => Jupyter.keyboard_manager.actions.exists('{action}')")
    page.evaluate(f"() => Jupyter.keyboard_manager.actions.call('{action}')")


def run_cell(page, index):
    page.evaluate(f"() => Jupyter.notebook.execute_cells([{index}])")


def send_cell(page, index):
    page.evaluate(f"() => Jupyter.notebook.select({index})")
    button(page, "send-cell-to-dashboard").click()


def open_with_panes(nbclassic_server, page, count):
    """Open a notebook of ``count`` cells named a0, a1, ... and send each to a new dashboard."""
    nbclassic_server.open_notebook(page, [code(f"a{index}") for index in range(count)])
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    for index in range(count):
        send_cell(page, index)
    expect(dashboard.locator(".pane")).to_have_count(count)
    return dashboard


def pane_box(dashboard, name):
    return dashboard.locator(".pane", has_text=name).bounding_box()


def pane_title(dashboard, name):
    return dashboard.locator(".pane_title", has_text=name)


def close_pane(dashboard, name):
    dashboard.locator(".pane", has_text=name).locator("button", has_text="[x]").click()


def test_a_sent_cell_shows_its_title_and_output(nbclassic_server, page):
    cell = code("print('one')\nprint('two')")
    cell.outputs = [new_output("stream", name="stdout", text="one\ntwo\n")]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    expect(dashboard.locator("#hint")).to_be_visible()

    button(page, "send-cell-to-dashboard").click()

    expect(dashboard.locator(".pane_title")).to_have_text("print('one')")
    expect(dashboard.locator(".pane_outputs pre")).to_have_text("one\ntwo\n")


def test_the_first_send_opens_the_dashboard(nbclassic_server, page):
    cell = code("a = 1")
    cell.outputs = [new_output("stream", name="stdout", text="early\n")]
    nbclassic_server.open_notebook(page, [cell])
    expect(button(page, "open-dashboard")).to_have_count(0)

    with page.expect_popup() as popup:
        button(page, "send-cell-to-dashboard").click()

    expect(popup.value.locator(".pane_outputs pre")).to_have_text("early\n")


def test_the_t_key_sends_the_selected_cell(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("a0"), code("a1")])
    dashboard = open_dashboard(page)
    page.evaluate("() => { Jupyter.notebook.select(1); Jupyter.notebook.command_mode(); }")

    page.keyboard.press("t")

    expect(dashboard.locator(".pane_title")).to_have_text(["a1"])


def test_typing_t_in_a_cell_sends_nothing(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("")])
    dashboard = open_dashboard(page)
    page.evaluate("() => { Jupyter.notebook.select(0); Jupyter.notebook.edit_mode(); }")

    page.keyboard.type("tt")

    page.wait_for_function("() => Jupyter.notebook.get_cell(0).get_text() === 'tt'")
    assert dashboard.locator(".pane").count() == 0


def test_shift_t_stacks_the_cell_below_a_wide_pane(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("a0"), code("a1")])
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    page.evaluate("() => { Jupyter.notebook.select(1); Jupyter.notebook.command_mode(); }")

    page.keyboard.press("Shift+T")

    expect(dashboard.locator(".pane")).to_have_count(2)
    upper = pane_box(dashboard, "a0")
    lower = pane_box(dashboard, "a1")
    assert upper["width"] == lower["width"] == 1000
    assert upper["y"] + upper["height"] <= lower["y"]


def test_sending_again_keeps_one_dashboard(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("a0"), code("a1")])
    with page.expect_popup() as popup:
        send_cell(page, 0)
    dashboard = popup.value

    send_cell(page, 1)

    expect(dashboard.locator(".pane")).to_have_count(2)
    assert len(page.context.pages) == 2


def test_a_send_reopens_a_closed_dashboard_with_every_linked_cell(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("a0"), code("a1")])
    with page.expect_popup() as popup:
        send_cell(page, 0)
    expect(popup.value.locator(".pane")).to_have_count(1)
    popup.value.close()

    with page.expect_popup() as reopened:
        send_cell(page, 1)

    expect(reopened.value.locator(".pane_title")).to_have_text(["a0", "a1"])


def test_opening_twice_keeps_the_window_and_its_layout(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2
    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(250, middle)
    dashboard.mouse.up()
    dashboard.evaluate("() => { window.kept = true; }")

    call_open_action(page)

    assert len(page.context.pages) == 2
    assert dashboard.evaluate("() => window.kept === true")
    assert pane_box(dashboard, "a0")["width"] == pytest.approx(248, abs=4)


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

    image = dashboard.locator(".pane_outputs img")
    expect(image).to_be_visible()
    dashboard.wait_for_function(
        "() => document.querySelector('.pane_outputs img').naturalWidth > 0"
    )
    box = image.bounding_box()
    assert box["width"] > 700
    assert box["height"] > 450


def test_running_a_linked_cell_refreshes_its_pane(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("print('one')")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()
    run_cell(page, 0)
    expect(dashboard.locator(".pane_outputs pre")).to_have_text("one\n")

    page.evaluate("() => Jupyter.notebook.get_cell(0).set_text(\"print('two')\")")
    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs pre")).to_have_text("two\n")
    expect(dashboard.locator(".pane_title")).to_have_text("print('two')")


def test_a_stream_shows_what_its_carriage_returns_left(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(r"print('old text\rnew')")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs pre")).to_have_text("new text\n")


def test_a_failed_run_shows_its_traceback(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("1 / 0")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs pre")).to_contain_text("ZeroDivisionError")
    expect(dashboard.locator(".pane_outputs pre")).not_to_contain_text("\x1b")


def test_a_table_from_a_run_shows_as_a_table(nbclassic_server, page):
    source = "from IPython.display import HTML\nHTML('<table><tr><td>value</td></tr></table>')"
    nbclassic_server.open_notebook(page, [code(source)], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    button(page, "send-cell-to-dashboard").click()

    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs td")).to_have_text("value")


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

    expect(dashboard.locator(".pane_outputs pre")).to_have_text("frame")
    expect(dashboard.locator(".pane_outputs td")).to_have_count(0)


def test_two_panes_share_the_window_side_by_side(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    left = pane_box(dashboard, "a0")
    right = pane_box(dashboard, "a1")

    assert left["x"] + left["width"] <= right["x"]
    assert left["height"] == right["height"]
    assert left["width"] == pytest.approx(right["width"], abs=1)


def test_a_third_pane_stacks_beside_a_half_window_pane(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 3)

    left = pane_box(dashboard, "a0")
    upper = pane_box(dashboard, "a1")
    lower = pane_box(dashboard, "a2")

    assert left["width"] == pytest.approx(upper["width"], abs=4)
    assert upper["x"] == lower["x"]
    assert upper["y"] + upper["height"] <= lower["y"]
    assert left["height"] > upper["height"] * 1.9


def test_each_linked_cell_refreshes_its_own_pane(nbclassic_server, page):
    cells = [code("print('first')"), code("print('second')")]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    dashboard = open_dashboard(page)
    send_cell(page, 0)
    send_cell(page, 1)

    page.evaluate("() => Jupyter.notebook.execute_cells([0, 1])")

    expect(dashboard.locator(".pane", has_text="print('first')").locator("pre")).to_have_text(
        "first\n"
    )
    expect(dashboard.locator(".pane", has_text="print('second')").locator("pre")).to_have_text(
        "second\n"
    )


def test_a_reloaded_window_gets_every_linked_cell_back(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 3)

    dashboard.reload()

    expect(dashboard.locator(".pane_title")).to_have_text(["a0", "a1", "a2"])


def test_dropping_a_pane_on_an_edge_splits_that_pane(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    target = pane_box(dashboard, "a1")

    dashboard.locator(".pane_title", has_text="a0").drag_to(
        dashboard.locator(".pane", has_text="a1"),
        target_position={"x": target["width"] / 2, "y": target["height"] - 5},
    )

    upper = pane_box(dashboard, "a1")
    lower = pane_box(dashboard, "a0")
    assert upper["x"] == lower["x"]
    assert upper["y"] + upper["height"] <= lower["y"]


def test_dragging_a_divider_resizes_its_panes(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2

    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(250, middle)
    dashboard.mouse.up()
    dashboard.mouse.move(600, middle)

    assert pane_box(dashboard, "a0")["width"] == pytest.approx(247, abs=4)
    assert pane_box(dashboard, "a1")["width"] == pytest.approx(747, abs=4)


def test_a_divider_stops_short_of_closing_a_pane(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2

    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(5, middle)
    dashboard.mouse.up()

    assert pane_box(dashboard, "a0")["width"] == pytest.approx(99, abs=4)


def test_closing_a_pane_gives_its_space_back(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    close_pane(dashboard, "a0")

    expect(dashboard.locator(".pane")).to_have_count(1)
    assert pane_box(dashboard, "a1")["width"] == 1000


def test_closing_a_cells_pane_keeps_it_out_after_a_reload(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    close_pane(dashboard, "a0")
    expect(dashboard.locator(".pane")).to_have_count(1)
    dashboard.reload()

    expect(dashboard.locator(".pane", has_text="a1")).to_be_visible()
    expect(dashboard.locator(".pane")).to_have_count(1)


def test_dropping_on_a_row_edge_gives_three_equal_panes(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 3)
    target = pane_box(dashboard, "a1")

    dashboard.locator(".pane_title", has_text="a2").drag_to(
        dashboard.locator(".pane", has_text="a1"),
        target_position={"x": target["width"] - 5, "y": target["height"] / 2},
    )

    # the nested split also holds a divider, so the panes differ by a few pixels
    widths = [pane_box(dashboard, name)["width"] for name in ("a0", "a1", "a2")]
    assert widths == pytest.approx([329, 329, 329], abs=3)


def test_a_drop_leaves_no_preview_behind(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    target = pane_box(dashboard, "a1")

    dashboard.locator(".pane_title", has_text="a0").drag_to(
        dashboard.locator(".pane", has_text="a1"),
        target_position={"x": target["width"] / 2, "y": 5},
    )

    expect(dashboard.locator("[data-drop]")).to_have_count(0)


def test_the_jump_button_selects_and_scrolls_to_the_cell(nbclassic_server, page):
    cells = [code(f"a{index}") for index in range(60)]
    nbclassic_server.open_notebook(page, cells)
    dashboard = open_dashboard(page)
    send_cell(page, 50)
    page.evaluate("() => Jupyter.notebook.select(0)")
    page.evaluate("() => { Jupyter.notebook.scroll_manager.element[0].scrollTop = 0; }")

    dashboard.locator(".pane", has_text="a50").locator("button", has_text="[>]").click()

    page.wait_for_function("() => Jupyter.notebook.get_selected_index() === 50")
    page.wait_for_function(
        """() => {
            const cell = Jupyter.notebook.get_cell(50).element[0].getBoundingClientRect();
            const site = Jupyter.notebook.scroll_manager.element[0].getBoundingClientRect();
            return cell.top >= site.top && cell.top < site.bottom;
        }"""
    )


def test_double_clicking_a_divider_evens_its_run(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2
    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(250, middle)
    dashboard.mouse.up()

    dashboard.locator(".divider").dblclick()

    assert pane_box(dashboard, "a0")["width"] == pytest.approx(497, abs=2)
    assert pane_box(dashboard, "a1")["width"] == pytest.approx(497, abs=2)


def test_double_clicking_a_stacks_divider_leaves_the_row_alone(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 3)
    outer = dashboard.locator("#panes > .split > .divider").bounding_box()
    middle = outer["y"] + outer["height"] / 2
    dashboard.mouse.move(outer["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(300, middle)
    dashboard.mouse.up()
    inner = dashboard.locator(".split.column > .divider").bounding_box()
    center = inner["x"] + inner["width"] / 2
    dashboard.mouse.move(center, inner["y"] + 3)
    dashboard.mouse.down()
    dashboard.mouse.move(center, 100)
    dashboard.mouse.up()
    left = pane_box(dashboard, "a0")["width"]

    dashboard.locator(".split.column > .divider").dblclick()

    assert pane_box(dashboard, "a0")["width"] == pytest.approx(left, abs=1)
    assert pane_box(dashboard, "a1")["height"] == pytest.approx(297, abs=2)
    assert pane_box(dashboard, "a2")["height"] == pytest.approx(297, abs=2)


def test_dragging_a_divider_keeps_a_panes_scroll_position(nbclassic_server, page):
    cells = [code("long"), code("short")]
    cells[0].outputs = [new_output("stream", name="stdout", text="line\n" * 500)]
    nbclassic_server.open_notebook(page, cells)
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    send_cell(page, 1)
    expect(dashboard.locator(".pane")).to_have_count(2)
    dashboard.evaluate("() => { document.querySelector('.pane_outputs').scrollTop = 500; }")
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2

    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(600, middle)
    dashboard.mouse.up()

    assert pane_box(dashboard, "long")["width"] > 550
    assert dashboard.evaluate("() => document.querySelector('.pane_outputs').scrollTop") == 500


def test_a_pane_shows_its_cells_index(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    expect(pane_title(dashboard, "a1")).to_have_attribute("data-cell-index", "1")


def test_a_pane_follows_its_cell_when_the_notebook_changes(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    page.evaluate("() => Jupyter.notebook.insert_cell_at_index('code', 0)")
    expect(pane_title(dashboard, "a1")).to_have_attribute("data-cell-index", "2")

    page.evaluate("() => { Jupyter.notebook.select(2); Jupyter.notebook.move_cell_up(); }")
    expect(pane_title(dashboard, "a1")).to_have_attribute("data-cell-index", "1")


def test_a_deleted_cells_pane_drops_its_index(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)

    page.evaluate("() => Jupyter.notebook.delete_cells([0])")

    expect(pane_title(dashboard, "a1")).to_have_attribute("data-cell-index", "0")
    expect(dashboard.locator(".pane_title[data-cell-index]")).to_have_count(1)


def test_a_plot_below_a_long_stream_keeps_its_size(nbclassic_server, page):
    cell = code("fit")
    cell.outputs = [
        new_output("stream", name="stdout", text="line\n" * 200),
        new_output("display_data", data={"image/svg+xml": RED_SQUARE_SVG}),
    ]
    nbclassic_server.open_notebook(page, [cell])
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 800, "height": 600})

    button(page, "send-cell-to-dashboard").click()

    image = dashboard.locator(".pane_outputs img")
    image.scroll_into_view_if_needed()
    expect(image).to_be_in_viewport()
    assert image.bounding_box()["height"] >= 16


def test_a_new_pane_keeps_the_other_panes_scrolled(nbclassic_server, page):
    cells = [code("long"), code("short")]
    cells[0].outputs = [new_output("stream", name="stdout", text="line\n" * 500)]
    nbclassic_server.open_notebook(page, cells)
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    expect(dashboard.locator(".pane")).to_have_count(1)
    dashboard.evaluate("() => { document.querySelector('.pane_outputs').scrollTop = 500; }")

    send_cell(page, 1)

    expect(dashboard.locator(".pane")).to_have_count(2)
    assert dashboard.evaluate("() => document.querySelector('.pane_outputs').scrollTop") == 500


def test_a_refresh_keeps_the_pane_scrolled(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("print('line\\n' * 500)")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    send_cell(page, 0)
    run_cell(page, 0)
    expect(dashboard.locator(".pane_outputs pre")).to_contain_text("line")
    dashboard.evaluate("() => { document.querySelector('.pane_outputs').scrollTop = 500; }")
    page.evaluate("() => Jupyter.notebook.get_cell(0).set_text(\"print('again\\\\n' * 500)\")")

    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs pre")).to_contain_text("again")
    assert dashboard.evaluate("() => document.querySelector('.pane_outputs').scrollTop") == 500


def test_opening_again_brings_back_a_window_sent_to_another_site(nbclassic_server, page):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.context.route(
        "https://elsewhere.test/**",
        lambda route: route.fulfill(body="<p>elsewhere</p>", content_type="text/html"),
    )
    nbclassic_server.open_notebook(page, [code("a = 1")])
    dashboard = open_dashboard(page)
    dashboard.wait_for_url("**/dashboard.html*")
    # as a link in a pane would, since the notebook may not navigate a window the user sent away
    dashboard.evaluate("() => { location.href = 'https://elsewhere.test/'; }")
    dashboard.wait_for_url("https://elsewhere.test/**")

    call_open_action(page)

    dashboard.wait_for_url("**/dashboard.html*")
    assert len(page.context.pages) == 2
    assert errors == []


def test_a_linked_cell_is_marked_until_its_pane_closes(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    linked = page.locator(".cell.cell_dashboard_linked")
    expect(linked).to_have_count(2)

    close_pane(dashboard, "a0")

    expect(linked).to_have_count(1)
    expect(page.locator(".cell").nth(1)).to_have_class(re.compile("cell_dashboard_linked"))


def test_a_reloaded_notebook_takes_back_its_links(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("print('one')")], wait_for_kernel=True)
    dashboard = open_dashboard(page)
    send_cell(page, 0)
    expect(dashboard.locator(".pane")).to_have_count(1)

    page.reload()
    page.wait_for_function(
        "() => { const notebook = window.Jupyter && Jupyter.notebook;"
        " const kernel = notebook && notebook.kernel;"
        " return !!notebook && notebook._fully_loaded"
        " && !!kernel && kernel.is_connected()"
        " && !!(kernel.info_reply.language_info || {}).name; }",
        timeout=45000,
    )
    expect(page.locator(".cell.cell_dashboard_linked")).to_have_count(1)
    run_cell(page, 0)

    expect(dashboard.locator(".pane_outputs pre")).to_have_text("one\n")


def test_a_reloaded_dashboard_keeps_its_arrangement(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code("a0"), code("a1")])
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    page.evaluate("() => { Jupyter.notebook.select(1); Jupyter.notebook.command_mode(); }")
    page.keyboard.press("Shift+T")
    expect(dashboard.locator(".split.column")).to_have_count(1)

    dashboard.reload()

    expect(dashboard.locator(".split.column")).to_have_count(1)
    upper = pane_box(dashboard, "a0")
    lower = pane_box(dashboard, "a1")
    assert upper["y"] + upper["height"] <= lower["y"]


def test_a_reloaded_dashboard_keeps_its_divider_sizes(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    divider = dashboard.locator(".divider").bounding_box()
    middle = divider["y"] + divider["height"] / 2
    dashboard.mouse.move(divider["x"] + 3, middle)
    dashboard.mouse.down()
    dashboard.mouse.move(250, middle)
    dashboard.mouse.up()

    dashboard.reload()

    expect(dashboard.locator(".pane")).to_have_count(2)
    assert pane_box(dashboard, "a0")["width"] == pytest.approx(248, abs=4)


def test_a_deleted_cells_pane_is_marked_until_the_delete_is_undone(nbclassic_server, page):
    dashboard = open_with_panes(nbclassic_server, page, 2)
    gone = dashboard.locator(".pane.pane_disconnected")

    page.evaluate("() => Jupyter.notebook.delete_cells([0])")
    expect(gone).to_have_count(1)
    expect(gone).to_contain_text("a0")

    page.evaluate("() => Jupyter.notebook.undelete_cell()")
    expect(gone).to_have_count(0)
    expect(page.locator(".cell.cell_dashboard_linked")).to_have_count(2)


# the semicolon keeps the list of lines out of the outputs, so the plot is alone in its pane
PLOT = (
    "import matplotlib.pyplot as plt\nfig, ax = plt.subplots(figsize=(4, 3))\nax.plot([1, 2, 3]);"
)

FITS_ITS_BOX = """() => {
    const image = document.querySelector('.pane_outputs > img');
    return !!image && image.complete
        && Math.abs(image.naturalWidth - image.clientWidth * devicePixelRatio) <= 1
        && Math.abs(image.naturalHeight - image.clientHeight * devicePixelRatio) <= 1;
}"""


def open_plot_pane(nbclassic_server, page, cells):
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    run_cell(page, 0)
    dashboard.locator(".pane_outputs > img").wait_for()
    return dashboard


def open_auto_plot_pane(nbclassic_server, page, cells):
    dashboard = open_plot_pane(nbclassic_server, page, cells)
    dashboard.locator(".pane_auto").click()
    return dashboard


def test_a_linked_plot_is_redrawn_at_its_pane_size(nbclassic_server, page):
    dashboard = open_auto_plot_pane(nbclassic_server, page, [code(PLOT)])

    dashboard.wait_for_function(FITS_ITS_BOX)

    width = dashboard.evaluate("() => document.querySelector('.pane_outputs > img').naturalWidth")
    assert width > 900
    expect(page.locator(".input_prompt").first).to_contain_text("[1]")


def test_a_plot_beside_its_cells_result_is_redrawn_in_the_room_left(nbclassic_server, page):
    dashboard = open_auto_plot_pane(nbclassic_server, page, [code(PLOT.removesuffix(";"))])
    expect(dashboard.locator(".pane_outputs pre")).to_contain_text("Line2D")

    dashboard.wait_for_function(FITS_ITS_BOX)

    box = dashboard.locator(".pane_outputs > img").bounding_box()
    assert box["width"] > 900
    assert box["height"] > 400


def test_a_redrawn_plot_follows_the_window_size(nbclassic_server, page):
    dashboard = open_auto_plot_pane(nbclassic_server, page, [code(PLOT)])
    dashboard.wait_for_function(FITS_ITS_BOX)

    dashboard.set_viewport_size({"width": 600, "height": 700})

    dashboard.wait_for_function(
        f"() => ({FITS_ITS_BOX})()"
        " && document.querySelector('.pane_outputs > img').naturalWidth < 600"
    )


def test_a_plot_changed_after_it_was_shown_keeps_its_last_drawing(nbclassic_server, page):
    dashboard = open_auto_plot_pane(
        nbclassic_server, page, [code(PLOT), code("ax.plot([3, 2, 1]);")]
    )
    dashboard.wait_for_function(FITS_ITS_BOX)
    drawn = dashboard.evaluate("() => document.querySelector('.pane_outputs > img').naturalWidth")
    run_cell(page, 1)
    page.locator(".cell").nth(1).locator(".input_prompt").filter(has_text="2").wait_for()

    dashboard.set_viewport_size({"width": 600, "height": 700})
    expect(dashboard.locator(".pane_reset")).to_be_visible()

    shown = dashboard.evaluate("() => document.querySelector('.pane_outputs > img').naturalWidth")
    assert shown == drawn


def test_a_plot_from_an_unlinked_cell_keeps_no_figure_id(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(PLOT)], wait_for_kernel=True)

    run_cell(page, 0)
    page.locator(".output_png img").wait_for()

    metadata = page.evaluate("() => Jupyter.notebook.get_cell(0).output_area.toJSON()[0].metadata")
    assert "cell_dashboard" not in metadata


def test_a_cell_tagged_dashboard_no_redraw_keeps_its_drawing(nbclassic_server, page):
    cell = code(PLOT)
    cell.metadata["tags"] = ["dashboard-no-redraw"]
    dashboard = open_plot_pane(nbclassic_server, page, [cell])

    assert dashboard.locator(".pane_outputs > img").get_attribute("data-figure") is None


def test_a_new_plot_pane_keeps_its_drawing_until_asked_to_redraw(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(PLOT)], wait_for_kernel=True)
    page.evaluate("""() => {
        let kernel = Jupyter.notebook.kernel;
        let execute = kernel.execute.bind(kernel);
        window.renders = 0;
        kernel.execute = (code, callbacks, options) => {
            window.renders += 'render' in (options?.user_expressions ?? {});
            return execute(code, callbacks, options);
        };
    }""")
    dashboard = open_dashboard(page)
    dashboard.set_viewport_size({"width": 1000, "height": 600})
    send_cell(page, 0)
    run_cell(page, 0)
    dashboard.locator(".pane_outputs > img").wait_for()
    page.wait_for_function("() => !Jupyter.notebook.kernel_busy")

    dashboard.locator(".pane_redraw").click()

    dashboard.wait_for_function(FITS_ITS_BOX)
    assert page.evaluate("() => window.renders") == 1


def test_reset_puts_back_the_size_the_cell_drew(nbclassic_server, page):
    dashboard = open_plot_pane(nbclassic_server, page, [code(PLOT)])
    image = dashboard.locator(".pane_outputs > img")
    drawn = image.evaluate("(image) => image.naturalWidth")
    dashboard.locator(".pane_redraw").click()
    dashboard.wait_for_function(FITS_ITS_BOX)

    dashboard.locator(".pane_reset").click()

    dashboard.wait_for_function(
        f"() => document.querySelector('.pane_outputs > img').naturalWidth === {drawn}"
    )
    expect(dashboard.locator(".pane_reset")).to_be_hidden()


def test_alt_t_sends_and_runs_a_plot_ready_to_redraw(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [code(PLOT)], wait_for_kernel=True)
    page.evaluate("() => { Jupyter.notebook.select(0); Jupyter.notebook.command_mode(); }")

    with page.expect_popup() as popup:
        page.keyboard.press("Alt+t")

    expect(popup.value.locator(".pane_redraw")).to_be_visible()

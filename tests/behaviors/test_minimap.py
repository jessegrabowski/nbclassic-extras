import base64
import re
import struct
import zlib

from nbformat.v4 import new_output
from playwright.sync_api import expect
import pytest
from slideshow import code, enter_slideshow, exit_slideshow, markdown


def solid_red_png(size):
    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    pixels = (b"\x00" + b"\xff\x00\x00" * size) * size
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


RED_PNG = solid_red_png(160)


def pixel_in_strip(condition):
    """Return a page function that finds a strip pixel meeting a condition on its channels."""
    return f"""() => {{
        const canvas = document.getElementById('minimap');
        const {{data}} = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 0; offset < data.length; offset += 4) {{
            const [red, green, blue, alpha] = data.subarray(offset, offset + 4);
            if ({condition}) {{
                return true;
            }}
        }}
        return false;
    }}"""


RED_PIXEL_IN_STRIP = pixel_in_strip("red > 200 && green < 60 && alpha > 200")
GRAY_BLOCK_IN_STRIP = pixel_in_strip("alpha > 200 && red === 225 && blue === 233")

INKED_ROWS = """() => {
    const canvas = document.getElementById('minimap');
    const {data, width, height} = canvas.getContext('2d')
        .getImageData(0, 0, canvas.width, canvas.height);
    const ratio = canvas.height / canvas.clientHeight;
    const rows = new Set();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[4 * (y * width + x) + 3] > 200) {
                rows.add(Math.floor(y / ratio));
            }
        }
    }
    return [...rows];
}"""


def open_with_strip(nbclassic_server, page, cells):
    page.set_viewport_size({"width": 1400, "height": 700})
    nbclassic_server.open_notebook(page, cells)
    expect(page.locator("#minimap")).to_be_visible()


def inked_rows(page):
    return page.evaluate(INKED_ROWS)


def wait_for_strip_rows(page, comparison, count):
    page.wait_for_function(f"(count) => ({INKED_ROWS})().length {comparison} count", arg=count)


def notebook_scroll_top(page):
    return page.evaluate("() => Jupyter.notebook.scroll_manager.element[0].scrollTop")


def test_the_strip_sits_inside_the_page_beside_the_scrollbar(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(40)])

    # the strip shows before the stylesheet and its first draw place it
    page.wait_for_function(
        """() => {
            const strip = document.getElementById('minimap').getBoundingClientRect();
            const site = document.getElementById('site').getBoundingClientRect();
            return Math.abs(strip.top - site.top) < 1
                && strip.right <= site.right
                && strip.right >= site.right - 20;
        }"""
    )


def assert_strip_clears_the_cells(page):
    # the stylesheet loads after the strip appears
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")
    expect(page.locator("#minimap")).to_be_visible()
    strip = page.locator("#minimap").bounding_box()
    notebook = page.locator("#notebook-container").bounding_box()
    assert notebook["x"] + notebook["width"] <= strip["x"]


@pytest.mark.parametrize("width", [700, 960, 1250, 1600])
def test_the_strip_clears_the_cells_at_any_window_width(nbclassic_server, page, width):
    page.set_viewport_size({"width": width, "height": 700})
    nbclassic_server.open_notebook(page, [code("a = 1") for _ in range(40)])

    assert_strip_clears_the_cells(page)


def test_the_strip_clears_the_cells_when_a_user_widens_the_notebook(nbclassic_server, page):
    page.set_viewport_size({"width": 1400, "height": 700})
    nbclassic_server.open_notebook(page, [code("a = 1") for _ in range(40)])

    page.add_style_tag(content=".container { width: 100%; }")

    assert_strip_clears_the_cells(page)


def test_a_phone_width_window_hides_the_strip_and_its_column(nbclassic_server, page):
    page.set_viewport_size({"width": 500, "height": 700})
    nbclassic_server.open_notebook(page, [code("a = 1")])

    expect(page.locator("#notebook")).to_have_css("padding-right", "0px")
    expect(page.locator("#minimap")).to_be_hidden()


def test_a_window_just_wider_than_a_phone_keeps_the_strip(nbclassic_server, page):
    page.set_viewport_size({"width": 501, "height": 700})
    nbclassic_server.open_notebook(page, [code("a = 1")])

    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")
    expect(page.locator("#minimap")).to_be_visible()


def test_a_printed_notebook_leaves_out_the_strip_and_its_column(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1")])
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")

    page.emulate_media(media="print")

    expect(page.locator("#notebook")).to_have_css("padding-right", "0px")
    expect(page.locator("#minimap")).to_be_hidden()


def test_a_slideshow_hides_the_strip_and_frees_its_column(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [markdown("# One", "slide"), code("a = 1")])
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")

    enter_slideshow(page)

    expect(page.locator("#minimap")).to_be_hidden()
    expect(page.locator("#notebook")).not_to_have_css("padding-right", "116px")

    exit_slideshow(page)

    expect(page.locator("#minimap")).to_be_visible()
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")


def test_toggling_the_toolbar_moves_the_strip_with_the_notebook(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(40)])
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")

    # the toolbar actions also save the choice to the server's config, which later tests would read
    offsets = page.evaluate(
        """async () => {
            $('#maintoolbar').hide();
            Jupyter.notebook.events.trigger('resize-header.Page');
            // the next frame leaves no time for another redraw to move the strip instead
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const strip = document.getElementById('minimap').getBoundingClientRect();
            const site = document.getElementById('site').getBoundingClientRect();
            return [Math.abs(strip.top - site.top), Math.abs(strip.height - site.height)];
        }"""
    )

    assert max(offsets) < 1


def test_the_toolbar_button_hides_the_strip_and_frees_its_column(nbclassic_server, page):
    page.set_viewport_size({"width": 1000, "height": 700})
    nbclassic_server.open_notebook(page, [code("a = 1")])
    button = page.locator("button[data-jupyter-action='minimap:toggle-minimap']")
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")

    button.click()

    expect(page.locator("#minimap")).to_be_hidden()
    expect(page.locator("#notebook")).not_to_have_css("padding-right", "116px")

    page.reload()

    expect(page.locator("#minimap")).to_be_hidden()

    button.click()

    expect(page.locator("#minimap")).to_be_visible()
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")
    wait_for_strip_rows(page, ">", 0)


def test_the_strip_draws_headings_and_prose(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [markdown("# Title\n\nSome prose", "")])

    # the red channels of the two colors, under the viewport marker's tint
    page.wait_for_function(pixel_in_strip("alpha > 200 && red >= 50 && red <= 70"))
    page.wait_for_function(pixel_in_strip("alpha > 200 && red >= 170 && red <= 180"))


def test_code_takes_the_colors_of_the_syntax_theme(nbclassic_server, page):
    # the viewport marker tints what it covers, so the code sits below it
    source = "def name():\n    return 'some text here'"
    cells = [code("a = 1") for _ in range(12)] + [code(source)]
    open_with_strip(nbclassic_server, page, cells)

    keyword = "alpha > 200 && green > red + 40 && green > blue + 40"
    string = "alpha > 200 && red > green + 40 && red > blue + 40"
    page.wait_for_function(pixel_in_strip(keyword))
    page.wait_for_function(pixel_in_strip(string))


def test_a_code_cell_draws_inside_a_shaded_frame(nbclassic_server, page):
    # the viewport marker tints what it covers, so the frame sits below it
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(20)])

    page.wait_for_function(pixel_in_strip("alpha > 200 && red === 247 && blue === 247"))


def test_code_stays_inside_its_frame_in_a_narrow_window(nbclassic_server, page):
    page.set_viewport_size({"width": 720, "height": 700})
    nbclassic_server.open_notebook(page, [code("a" * 90) for _ in range(5)])
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")
    wait_for_strip_rows(page, ">", 0)

    area = page.locator(".input_area").first.bounding_box()
    rightmost_ink = page.evaluate(
        """() => {
            const canvas = document.getElementById('minimap');
            const {data, width} = canvas.getContext('2d')
                .getImageData(0, 0, canvas.width, canvas.height);
            let rightmost = 0;
            for (let offset = 0; offset < data.length; offset += 4) {
                // the viewport marker's tint stays below this
                if (data[offset + 3] > 60) {
                    rightmost = Math.max(rightmost, (offset / 4) % width);
                }
            }
            return rightmost;
        }"""
    )

    assert rightmost_ink <= area["width"] / 8 + 1


def test_a_text_cell_editor_takes_the_colors_of_its_own_theme(nbclassic_server, page):
    # a code cell's keyword color comes first, and the viewport marker tints what it covers
    cells = [code("def name(): pass") for _ in range(12)]
    cells.append(markdown("```python\ndef name(): pass\n```", ""))
    open_with_strip(nbclassic_server, page, cells)
    page.wait_for_function(pixel_in_strip("alpha > 200 && green > red + 40 && green > blue + 40"))

    page.evaluate("() => Jupyter.notebook.get_cell(12).unrender()")

    page.wait_for_function(pixel_in_strip("alpha > 200 && red > green + 30 && blue > green + 30"))


def test_folding_an_input_redraws_the_strip_without_its_text(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("\n".join(["a = 1"] * 30))])
    page.wait_for_function(
        "() => Jupyter.keyboard_manager.actions.exists('cell_folds:fold-input-of-all')"
    )
    wait_for_strip_rows(page, ">", 0)
    before = len(inked_rows(page))

    page.evaluate("() => Jupyter.keyboard_manager.actions.call('cell_folds:fold-input-of-all')")

    wait_for_strip_rows(page, "<", before)


def test_editing_a_cell_redraws_the_strip(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1")])
    wait_for_strip_rows(page, ">", 0)
    before = len(inked_rows(page))

    page.evaluate("() => Jupyter.notebook.get_cell(0).set_text('a = 1\\n'.repeat(40))")

    wait_for_strip_rows(page, ">", before)


def test_a_png_output_draws_as_a_thumbnail(nbclassic_server, page):
    cell = code("plot")
    cell.outputs = [new_output("display_data", data={"image/png": RED_PNG})]
    open_with_strip(nbclassic_server, page, [cell])

    page.wait_for_function(RED_PIXEL_IN_STRIP)


def test_a_jpeg_output_draws_as_a_thumbnail(nbclassic_server, page):
    red_jpeg = page.evaluate(
        """() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 160;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ff0000';
            context.fillRect(0, 0, 160, 160);
            return canvas.toDataURL('image/jpeg').split(',')[1];
        }"""
    )
    cell = code("plot")
    cell.outputs = [new_output("display_data", data={"image/jpeg": red_jpeg})]
    open_with_strip(nbclassic_server, page, [cell])

    page.wait_for_function(RED_PIXEL_IN_STRIP)


def test_an_image_wider_than_the_strip_keeps_its_shape(nbclassic_server, page):
    cell = code("plot")
    cell.outputs = [new_output("display_data", data={"image/png": solid_red_png(1600)})]
    open_with_strip(nbclassic_server, page, [cell])
    page.wait_for_function(RED_PIXEL_IN_STRIP)

    width, height = page.evaluate(
        """() => {
            const canvas = document.getElementById('minimap');
            const {data, width} = canvas.getContext('2d')
                .getImageData(0, 0, canvas.width, canvas.height);
            const columns = new Set();
            const rows = new Set();
            for (let offset = 0; offset < data.length; offset += 4) {
                if (data[offset] > 200 && data[offset + 1] < 60 && data[offset + 3] > 200) {
                    columns.add((offset / 4) % width);
                    rows.add(Math.floor(offset / 4 / width));
                }
            }
            return [columns.size, rows.size];
        }"""
    )

    # past the strip's width, so the clamp is what this measures
    assert abs(width - 104) <= 1
    assert abs(width - height) <= 2


def test_a_broken_image_draws_as_a_gray_block(nbclassic_server, page):
    broken = new_output(
        "display_data",
        data={"image/png": "bm90IGEgcG5n"},
        metadata={"image/png": {"width": 400, "height": 400}},
    )
    # the viewport marker tints what it covers, so the image sits below it
    cell = code("plot")
    cell.outputs = [broken]
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(12)] + [cell])

    page.wait_for_function(GRAY_BLOCK_IN_STRIP)


@pytest.mark.parametrize(
    "output",
    [
        new_output("stream", name="stdout", text="a line of text\n" * 30),
        new_output("execute_result", data={"text/plain": "a line of text\n" * 30}),
        new_output("error", ename="E", evalue="v", traceback=["a line of text"] * 30),
    ],
    ids=["stream", "result", "error"],
)
def test_a_text_output_draws_its_lines(nbclassic_server, page, output):
    cell = code("a = 1")
    cell.outputs = [output]
    open_with_strip(nbclassic_server, page, [cell])

    wait_for_strip_rows(page, ">", 20)


@pytest.mark.parametrize(
    "output",
    [
        new_output("stream", name="stdout", text="a line of text\n" * 500),
        new_output(
            "display_data",
            data={"image/png": RED_PNG},
            metadata={"image/png": {"width": 800, "height": 2000}},
        ),
    ],
    ids=["text", "image"],
)
def test_a_scrolled_output_draws_only_what_the_page_shows(nbclassic_server, page, output):
    cell = code("a = 1")
    cell.outputs = [output]
    cell.metadata["scrolled"] = True
    open_with_strip(nbclassic_server, page, [cell])
    expect(page.locator(".output")).to_have_class(re.compile("output_scroll"))
    wait_for_strip_rows(page, ">", 20)

    shown = page.locator(".output").bounding_box()
    site = page.locator("#site").bounding_box()

    assert max(inked_rows(page)) <= (shown["y"] + shown["height"] - site["y"]) / 8 + 1


def test_scrolling_inside_an_output_redraws_the_strip(nbclassic_server, page):
    cell = code("a = 1")
    text = "".join("x" * (line % 40 + 1) + "\n" for line in range(500))
    cell.outputs = [new_output("stream", name="stdout", text=text)]
    cell.metadata["scrolled"] = True
    open_with_strip(nbclassic_server, page, [cell])
    expect(page.locator(".output")).to_have_class(re.compile("output_scroll"))
    wait_for_strip_rows(page, ">", 20)

    # scroll events and the redraw they ask for land in the next frame, ahead of a second one,
    # which leaves no time for another redraw to change the strip instead
    changed = page.evaluate(
        """async () => {
            const canvas = document.getElementById('minimap');
            const before = canvas.toDataURL();
            document.querySelector('.output_scroll').scrollTop = 3000;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
            return canvas.toDataURL() !== before;
        }"""
    )

    assert changed


def test_toggling_the_strip_remeasures_wrapped_editors(nbclassic_server, page):
    page.set_viewport_size({"width": 1000, "height": 700})
    nbclassic_server.open_notebook(page, [markdown("word " * 2000 + "\nend", "")])
    last_line_height = "Jupyter.notebook.get_cell(0).code_mirror.heightAtLine(1, 'local')"
    page.evaluate("() => Jupyter.notebook.get_cell(0).unrender()")
    expect(page.locator("#notebook")).to_have_css("padding-right", "116px")
    # the editor measures late after the stylesheet's width change, so this must not read too early
    before = page.evaluate(
        f"""() => {{
            Jupyter.notebook.get_cell(0).code_mirror.refresh();
            return {last_line_height};
        }}"""
    )

    page.locator("button[data-jupyter-action='minimap:toggle-minimap']").click()

    page.wait_for_function(f"(before) => {last_line_height} < before", arg=before)


def test_the_strip_draws_every_short_cell_down_its_whole_height(nbclassic_server, page):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    open_with_strip(nbclassic_server, page, [code("a = 1\nb = 2") for _ in range(100)])
    strip = page.locator("#minimap").bounding_box()

    wait_for_strip_rows(page, ">", strip["height"] / 2)

    assert max(inked_rows(page)) > strip["height"] - 40
    assert errors == []


def test_a_long_cell_keeps_drawing_when_scrolled_to_its_middle(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1\n" * 2000)])

    page.evaluate(
        """() => {
            const scroller = Jupyter.notebook.scroll_manager.element[0];
            scroller.scrollTop = scroller.scrollHeight / 2;
        }"""
    )

    # only text is this dark, so a frame alone would not pass
    page.wait_for_function(pixel_in_strip("alpha > 200 && red < 150"))


# rich's markup: a preformatted block of colored spans
RICH_HTML = (
    '<pre style="white-space:pre"><span style="color: #008000">━━━━━━━━━━━━━━━━━━━━</span>'
    '<span style="color: #3a3a3a">━━━━━━━━━━</span> 67%\n'
    '<span style="color: #800000">┏━━━━━━━━━━━━━━┓</span>\n</pre>'
)


def run_html_output(nbclassic_server, page, html):
    source = f"from IPython.display import HTML, display\ndisplay(HTML({html!r}))"
    page.set_viewport_size({"width": 1400, "height": 700})
    # the viewport marker tints what it covers, so the output sits below it
    cells = [code("a = 1") for _ in range(12)] + [code(source)]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)
    page.evaluate("() => Jupyter.notebook.execute_cells([12])")


def test_a_rich_display_draws_as_colored_text(nbclassic_server, page):
    run_html_output(nbclassic_server, page, RICH_HTML)

    # half opacity over a clear strip keeps the hue and halves the alpha
    page.wait_for_function(pixel_in_strip("alpha < 200 && green > 2 * red && green > 2 * blue"))
    page.wait_for_function(pixel_in_strip("alpha < 200 && red > 2 * green && red > 2 * blue"))
    assert not page.evaluate(GRAY_BLOCK_IN_STRIP)


def test_a_rich_display_inside_a_widget_area_skips_the_outer_block(nbclassic_server, page):
    nested = f'<div class="output_subarea">{RICH_HTML}</div>'
    run_html_output(nbclassic_server, page, nested)

    page.wait_for_function(pixel_in_strip("alpha < 200 && green > 2 * red && green > 2 * blue"))
    assert not page.evaluate(GRAY_BLOCK_IN_STRIP)


def test_a_preformatted_block_beside_other_html_stays_a_gray_block(nbclassic_server, page):
    html = "<pre>code</pre><table><tr><td>value</td></tr></table>"
    run_html_output(nbclassic_server, page, html)

    page.wait_for_function(GRAY_BLOCK_IN_STRIP)


def test_a_long_output_keeps_drawing_when_scrolled_to_its_middle(nbclassic_server, page):
    cell = code("a = 1")
    cell.outputs = [new_output("stream", name="stdout", text="a line of text\n" * 2000)]
    cell.metadata["scrolled"] = False
    open_with_strip(nbclassic_server, page, [cell])

    page.evaluate(
        """() => {
            const scroller = Jupyter.notebook.scroll_manager.element[0];
            scroller.scrollTop = scroller.scrollHeight / 2;
        }"""
    )

    wait_for_strip_rows(page, ">", 300)


def test_an_svg_output_draws_as_a_thumbnail(nbclassic_server, page):
    source = (
        "from IPython.display import SVG\n"
        'SVG(\'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">'
        '<rect width="200" height="200" fill="#ff0000"/></svg>\')'
    )
    page.set_viewport_size({"width": 1400, "height": 700})
    nbclassic_server.open_notebook(page, [code(source)], wait_for_kernel=True)

    page.evaluate("() => Jupyter.notebook.execute_cells([0])")

    page.wait_for_function(RED_PIXEL_IN_STRIP)


def test_a_folded_output_leaves_the_strip(nbclassic_server, page):
    cell = code("plot")
    cell.outputs = [new_output("display_data", data={"image/png": RED_PNG})]
    open_with_strip(nbclassic_server, page, [cell])
    page.wait_for_function(RED_PIXEL_IN_STRIP)

    page.evaluate("() => Jupyter.notebook.get_cell(0).collapse_output()")

    page.wait_for_function(f"() => !({RED_PIXEL_IN_STRIP})()")


def test_a_rich_output_holding_an_icon_still_draws_as_a_gray_block(nbclassic_server, page):
    source = (
        "from IPython.display import HTML\n"
        'HTML(\'<svg style="position: absolute; width: 0; height: 0"></svg>'
        '<table style="height: 300px"><tr><td>value</td></tr></table>\')'
    )
    page.set_viewport_size({"width": 1400, "height": 700})
    # the viewport marker tints what it covers, so the output sits below it
    cells = [code("a = 1") for _ in range(12)] + [code(source)]
    nbclassic_server.open_notebook(page, cells, wait_for_kernel=True)

    page.evaluate("() => Jupyter.notebook.execute_cells([12])")

    page.wait_for_function(GRAY_BLOCK_IN_STRIP)


def test_a_malformed_svg_does_not_stop_the_strip(nbclassic_server, page):
    source = "from IPython.display import display\ndisplay({'image/svg+xml': 'nope'}, raw=True)"
    page.set_viewport_size({"width": 1400, "height": 700})
    nbclassic_server.open_notebook(page, [code(source), code("a = 1")], wait_for_kernel=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.evaluate("() => Jupyter.notebook.execute_cells([0])")
    page.locator(".output_svg").wait_for(state="attached")
    wait_for_strip_rows(page, ">", 0)
    before = len(inked_rows(page))
    page.evaluate("() => Jupyter.notebook.get_cell(1).set_text('a = 1\\n'.repeat(40))")

    wait_for_strip_rows(page, ">", before)
    assert errors == []


def test_a_cell_of_an_unknown_type_does_not_stop_the_strip(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1")])
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.evaluate(
        """() => {
            const notebook = Jupyter.notebook;
            const content = notebook.toJSON();
            content.cells = [
                {cell_type: 'future', metadata: {}, source: ''},
                {
                    cell_type: 'code',
                    metadata: {},
                    source: 'a = 1',
                    outputs: [],
                    execution_count: null,
                },
            ];
            notebook.fromJSON({content: content});
        }"""
    )

    wait_for_strip_rows(page, ">", 0)
    assert errors == []


def test_clicking_the_strip_scrolls_the_notebook(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(80)])
    strip = page.locator("#minimap").bounding_box()

    page.mouse.click(strip["x"] + 20, strip["y"] + strip["height"] - 5)

    page.wait_for_function("() => Jupyter.notebook.scroll_manager.element[0].scrollTop > 0")


def test_the_wheel_over_the_strip_scrolls_the_notebook(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(80)])
    strip = page.locator("#minimap").bounding_box()

    page.mouse.move(strip["x"] + 20, strip["y"] + 100)
    page.mouse.wheel(0, 600)

    page.wait_for_function("() => Jupyter.notebook.scroll_manager.element[0].scrollTop === 600")


def test_scrolling_to_the_end_moves_the_viewport_marker_to_the_strip_bottom(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(200)])
    marker_at = """(row) => {
        const canvas = document.getElementById('minimap');
        // the first columns hold no ink, so any paint there is the marker
        return canvas.getContext('2d').getImageData(1, row, 1, 1).data[3] > 0;
    }"""
    page.wait_for_function(marker_at, arg=0)

    page.evaluate(
        """() => {
            const scroller = Jupyter.notebook.scroll_manager.element[0];
            scroller.scrollTop = scroller.scrollHeight;
        }"""
    )

    last_row = page.evaluate("() => document.getElementById('minimap').height - 1")
    page.wait_for_function(marker_at, arg=last_row)
    assert not page.evaluate(marker_at, 0)


def test_dragging_a_long_notebook_follows_the_pointer_until_release(nbclassic_server, page):
    open_with_strip(nbclassic_server, page, [code("a = 1") for _ in range(200)])
    strip = page.locator("#minimap").bounding_box()
    x = strip["x"] + 20
    middle = strip["y"] + strip["height"] / 2

    page.mouse.move(x, middle)
    page.mouse.down()
    going_up = [notebook_scroll_top(page)]
    for step in range(1, 13):
        page.mouse.move(x, middle - step)
        going_up.append(notebook_scroll_top(page))
    going_down = [going_up[-1]]
    for step in range(11, -1, -1):
        page.mouse.move(x, middle - step)
        going_down.append(notebook_scroll_top(page))
    page.mouse.up()
    released = notebook_scroll_top(page)
    page.mouse.move(x, middle + 100)

    assert going_up == sorted(going_up, reverse=True)
    assert going_up[-1] < going_up[0]
    assert going_down == sorted(going_down)
    assert going_down[-1] == going_up[0]
    assert notebook_scroll_top(page) == released

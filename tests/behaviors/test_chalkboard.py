from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown

PAINTED_PIXELS = """() => {
    const canvas = document.querySelector('#notescanvas canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) painted += 1;
    }
    return painted;
}"""
PEN_CURSOR = "() => document.querySelector('#notescanvas canvas').style.cursor"


def draw_stroke(page):
    page.mouse.move(400, 300)
    page.mouse.down()
    page.mouse.move(500, 350, steps=10)
    page.mouse.up()


def open_notes_canvas(nbclassic_server, page):
    metadata = {"rise": {"enable_chalkboard": True}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)
    page.keyboard.press("]")
    expect(page.locator("#notescanvas")).to_have_css("pointer-events", "auto")


def test_chalkboard_toggle_opens_the_board(nbclassic_server, page):
    nbclassic_server.open_notebook(
        page,
        [markdown("Alpha", "slide")],
        metadata={"rise": {"enable_chalkboard": True}},
    )
    enter_slideshow(page)
    board = page.locator("#chalkboard")
    expect(board).to_be_hidden()

    page.click("#toggle-chalkboard")
    expect(board).to_be_visible()


def test_drawing_on_the_notes_canvas_paints_and_minus_clears_it(nbclassic_server, page):
    open_notes_canvas(nbclassic_server, page)

    draw_stroke(page)
    assert page.evaluate(PAINTED_PIXELS) > 0

    page.keyboard.press("-")
    assert page.evaluate(PAINTED_PIXELS) == 0


def test_equals_resets_the_drawings_only_after_confirmation(nbclassic_server, page):
    open_notes_canvas(nbclassic_server, page)
    draw_stroke(page)

    page.once("dialog", lambda dialog: dialog.dismiss())
    page.keyboard.press("=")
    assert page.evaluate(PAINTED_PIXELS) > 0

    page.once("dialog", lambda dialog: dialog.accept())
    page.keyboard.press("=")
    assert page.evaluate(PAINTED_PIXELS) == 0


def test_s_and_q_cycle_the_pen_color(nbclassic_server, page):
    open_notes_canvas(nbclassic_server, page)
    first = page.evaluate(PEN_CURSOR)

    page.keyboard.press("s")
    assert page.evaluate(PEN_CURSOR) != first

    page.keyboard.press("q")
    assert page.evaluate(PEN_CURSOR) == first


def test_backslash_downloads_the_drawings(nbclassic_server, page):
    open_notes_canvas(nbclassic_server, page)

    with page.expect_download() as download:
        page.keyboard.press("\\")

    assert download.value.suggested_filename == "chalkboard.json"


def test_the_plugins_own_keys_stay_off_beside_rises(nbclassic_server, page):
    metadata = {"rise": {"enable_chalkboard": True}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    # c is the plugin's own notes canvas toggle; had it fired, ] would close the canvas again
    page.keyboard.press("c")
    page.keyboard.press("]")
    expect(page.locator("#notescanvas")).to_have_css("pointer-events", "auto")

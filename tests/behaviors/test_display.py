import re

from playwright.sync_api import expect
import pytest
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, has_class, markdown

TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="


def test_theme_option_loads_and_applies_the_theme_stylesheet(nbclassic_server, page):
    metadata = {"rise": {"theme": "serif"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("body")).to_have_class(has_class("theme-serif"))
    stylesheet = page.locator("link#theme")
    expect(stylesheet).to_have_attribute("href", re.compile(r"theme/serif\.css$"))
    # a stylesheet that failed to load has no readable rules
    rule_count = "(link) => { try { return link.sheet.cssRules.length; } catch { return 0; } }"
    assert stylesheet.evaluate(rule_count) > 0


def test_transition_option_sets_the_reveal_transition(nbclassic_server, page):
    metadata = {"rise": {"transition": "convex"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("div.reveal")).to_have_class(has_class("convex"))


def test_reveal_chrome_options_turn_each_element_off(nbclassic_server, page):
    metadata = {
        "rise": {"controls": False, "progress": False, "slideNumber": False, "center": False}
    }
    cells = [markdown("Alpha", "slide"), markdown("Bravo", "slide")]
    nbclassic_server.open_notebook(page, cells, metadata=metadata)
    enter_slideshow(page)

    expect(page.locator(".reveal .controls")).to_have_css("display", "none")
    expect(page.locator(".reveal .progress")).to_have_css("display", "none")
    expect(page.locator(".reveal .slide-number")).to_have_css("display", "none")
    expect(page.locator("div.reveal")).not_to_have_class(has_class("center"))


def test_width_option_sizes_the_slides(nbclassic_server, page):
    metadata = {"rise": {"width": 800}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("#notebook-container.slides")).to_have_css("width", "800px")


def test_header_footer_and_backimage_frame_the_slideshow(nbclassic_server, page):
    metadata = {
        "rise": {
            "header": "<b>Course title</b>",
            "footer": "<i>Page footer</i>",
            "backimage": TRANSPARENT_PIXEL,
        }
    }
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    header = page.locator("#rise-header")
    footer = page.locator("#rise-footer")
    backimage = page.locator("#rise-backimage")
    expect(header).to_have_text("Course title")
    expect(footer).to_have_text("Page footer")
    expect(header).to_be_visible()
    expect(footer).to_be_visible()
    expect(backimage).to_be_visible()
    expect(backimage).to_have_attribute("src", TRANSPARENT_PIXEL)

    # one layout snapshot: nbclassic resizes the notebook after RISE hides its header
    boxes = page.evaluate(
        "() => Object.fromEntries(['div.reveal', '#rise-header', '#rise-footer']"
        ".map((selector) => [selector, document.querySelector(selector).getBoundingClientRect()"
        ".toJSON()]))"
    )
    slideshow = boxes["div.reveal"]
    assert boxes["#rise-header"]["top"] == pytest.approx(slideshow["top"], abs=1)
    assert boxes["#rise-footer"]["bottom"] == pytest.approx(slideshow["bottom"], abs=1)


def test_rise_css_and_notebook_css_are_applied_in_the_slideshow(nbclassic_server, page):
    rule = "body.rise-enabled #notebook-container {{ outline: 3px solid {color}; }}\n"
    rise_css = nbclassic_server.notebook_dir / "rise.css"
    rise_css.write_text(rule.format(color="rgb(1, 2, 3)"))
    try:
        name = nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
        (nbclassic_server.notebook_dir / name.replace(".ipynb", ".css")).write_text(
            "body.rise-enabled #notebook-container { border-top: 4px solid rgb(4, 5, 6); }\n"
        )
        enter_slideshow(page)

        container = page.locator("#notebook-container")
        expect(container).to_have_css("outline-color", "rgb(1, 2, 3)")
        expect(container).to_have_css("border-top-color", "rgb(4, 5, 6)")
    finally:
        rise_css.unlink()


def test_scroll_option_makes_a_tall_subslide_scrollable(nbclassic_server, page):
    tall = "\n\n".join(f"Line {number}" for number in range(80))
    metadata = {"rise": {"scroll": True}}
    nbclassic_server.open_notebook(page, [markdown(tall, "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator(CURRENT_SUBSLIDE)).to_have_css("overflow-y", "scroll")


def test_tall_subslide_does_not_scroll_by_default(nbclassic_server, page):
    tall = "\n\n".join(f"Line {number}" for number in range(80))
    nbclassic_server.open_notebook(page, [markdown(tall, "slide")])
    enter_slideshow(page)
    subslide = page.locator(CURRENT_SUBSLIDE)

    # as tall as RISE's scroll option requires; RISE decides on reveal's ready, which has fired
    overflows = "(element) => element.offsetHeight > element.closest('.reveal').offsetHeight * 0.95"
    assert subslide.evaluate(overflows)
    expect(subslide).not_to_have_css("overflow-y", "scroll")

import re

from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, has_class, markdown


def test_theme_option_loads_the_theme_stylesheet(nbclassic_server, page):
    metadata = {"rise": {"theme": "sky"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("body")).to_have_class(has_class("theme-sky"))
    expect(page.locator("link#theme")).to_have_attribute("href", re.compile(r"theme/sky\.css$"))
    expect(page.locator("body")).to_have_css("background-image", re.compile(r"radial-gradient"))


def test_transition_option_sets_the_reveal_transition(nbclassic_server, page):
    metadata = {"rise": {"transition": "convex"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("div.reveal")).to_have_class(has_class("convex"))


def test_reveal_chrome_is_shown_by_default(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide"), markdown("Bravo", "slide")])
    enter_slideshow(page)

    expect(page.locator(".reveal .controls")).to_have_css("display", "block")
    expect(page.locator(".reveal .progress")).to_have_css("display", "block")
    expect(page.locator(".reveal .slide-number")).to_have_css("display", "block")
    expect(page.locator("div.reveal")).to_have_class(has_class("center"))


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


def test_header_and_footer_options_show_on_the_slide(nbclassic_server, page):
    metadata = {"rise": {"header": "<b>Course title</b>", "footer": "<i>Page footer</i>"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("#rise-header")).to_have_text("Course title")
    expect(page.locator("#rise-footer")).to_have_text("Page footer")
    expect(page.locator("#rise-header")).to_be_visible()


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


def test_show_buttons_on_startup_false_hides_the_rise_buttons(nbclassic_server, page):
    metadata = {"rise": {"show_buttons_on_startup": False}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("#exit_b")).to_have_count(1)
    expect(page.locator("#help_b")).to_have_count(1)
    expect(page.locator("#exit_b")).to_be_hidden(timeout=5000)
    expect(page.locator("#help_b")).to_be_hidden()


def test_autolaunch_enters_the_slideshow_on_load(nbclassic_server, page):
    metadata = {"rise": {"autolaunch": True}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)

    expect(page.locator("body")).to_have_class(has_class("rise-enabled"))
    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Alpha")

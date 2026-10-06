import re

from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown


def has_class(name):
    return re.compile(rf"(^|\s){re.escape(name)}(\s|$)")


def test_theme_option_loads_the_theme_stylesheet(nbclassic_server, page):
    metadata = {"rise": {"theme": "sky"}}
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
    enter_slideshow(page)

    expect(page.locator("body")).to_have_class(has_class("theme-sky"))
    expect(page.locator("link#theme")).to_have_attribute("href", re.compile(r"theme/sky\.css$"))
    expect(page.locator("body")).to_have_css("background-color", "rgb(247, 251, 252)")


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

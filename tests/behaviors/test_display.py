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

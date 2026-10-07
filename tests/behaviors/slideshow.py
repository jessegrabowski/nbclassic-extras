import re

from nbformat.v4 import new_code_cell, new_markdown_cell
from playwright.sync_api import expect


def has_class(name):
    """Match a class attribute that contains ``name`` as a whole class."""
    return re.compile(rf"(^|\s){re.escape(name)}(\s|$)")


CURRENT_SUBSLIDE = ".slides > section.present > section.present"
RISE_ENABLED = has_class("rise-enabled")
READY = has_class("ready")


def markdown(source, slide_type):
    return new_markdown_cell(source, metadata={"slideshow": {"slide_type": slide_type}})


def code(source, slide_type=""):
    return new_code_cell(source, metadata={"slideshow": {"slide_type": slide_type}})


def enter_slideshow(page):
    page.click("#RISE")
    expect(page.locator("body")).to_have_class(RISE_ENABLED)
    expect(page.locator("div.reveal")).to_have_class(READY)
    # reveal stays "ready" across entries; the slide hash is written once each entry is set up
    page.wait_for_function("() => location.hash.startsWith('#/slide-')")


def exit_slideshow(page):
    page.click("#exit_b")
    expect(page.locator("body")).not_to_have_class(RISE_ENABLED)

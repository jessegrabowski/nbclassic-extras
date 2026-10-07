import re

from nbformat.v4 import new_markdown_cell
from playwright.sync_api import expect

CURRENT_SUBSLIDE = ".slides > section.present > section.present"
RISE_ENABLED = re.compile(r"\brise-enabled\b")
READY = re.compile(r"\bready\b")


def markdown(source, slide_type):
    return new_markdown_cell(source, metadata={"slideshow": {"slide_type": slide_type}})


def enter_slideshow(page):
    page.click("#RISE")
    wait_for_slideshow(page)


def wait_for_slideshow(page):
    expect(page.locator("body")).to_have_class(RISE_ENABLED)
    expect(page.locator("div.reveal")).to_have_class(READY)
    # reveal stays "ready" across entries; the slide hash is written once each entry is set up
    page.wait_for_function("() => location.hash.startsWith('#/slide-')")


def exit_slideshow(page):
    page.click("#exit_b")
    expect(page.locator("body")).not_to_have_class(RISE_ENABLED)

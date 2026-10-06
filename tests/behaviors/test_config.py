import re

from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown

THEME_SERIF = re.compile(r"(^|\s)theme-serif(\s|$)")
ZOOM = re.compile(r"(^|\s)zoom(\s|$)")


def test_nbconfig_and_notebook_metadata_combine_with_metadata_winning(nbclassic_server, page):
    nbclassic_server.patch_nbconfig("rise", {"theme": "sky", "transition": "zoom"})
    try:
        metadata = {"rise": {"theme": "serif"}}
        nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
        enter_slideshow(page)

        expect(page.locator("body")).to_have_class(THEME_SERIF)
        expect(page.locator("div.reveal")).to_have_class(ZOOM)
    finally:
        nbclassic_server.patch_nbconfig("rise", {"theme": None, "transition": None})

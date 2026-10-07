from playwright.sync_api import expect
from slideshow import enter_slideshow, has_class, markdown


def test_nbconfig_and_notebook_metadata_combine_with_metadata_winning(nbclassic_server, page):
    nbclassic_server.patch_nbconfig("rise", {"theme": "sky", "transition": "zoom"})
    try:
        metadata = {"rise": {"theme": "serif"}}
        nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")], metadata=metadata)
        enter_slideshow(page)

        expect(page.locator("body")).to_have_class(has_class("theme-serif"))
        expect(page.locator("div.reveal")).to_have_class(has_class("zoom"))
    finally:
        nbclassic_server.patch_nbconfig("rise", {"theme": None, "transition": None})

import re

from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, markdown

VISIBLE = re.compile(r"\bvisible\b")


def test_navigation_visits_slides_subslides_and_fragments_in_order(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Bravo", "fragment"),
        markdown("Charlie", "subslide"),
        markdown("Delta", "slide"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    current = page.locator(CURRENT_SUBSLIDE)
    bravo = page.locator(".fragment", has_text="Bravo")

    expect(current).to_contain_text("Alpha")
    expect(bravo).not_to_have_class(VISIBLE)

    page.keyboard.press("Space")
    expect(bravo).to_have_class(VISIBLE)
    expect(current).to_contain_text("Alpha")

    page.keyboard.press("Space")
    expect(current).to_contain_text("Charlie")
    expect(current).not_to_contain_text("Alpha")

    page.keyboard.press("Space")
    expect(current).to_contain_text("Delta")

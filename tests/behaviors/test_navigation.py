import re

from playwright.sync_api import expect
from slideshow import CURRENT_SUBSLIDE, enter_slideshow, exit_slideshow, has_class, markdown

VISIBLE = has_class("visible")
OVERVIEW = has_class("overview")


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

    page.keyboard.press("Shift+Space")
    expect(current).to_contain_text("Charlie")

    page.keyboard.press("Shift+Space")
    expect(current).to_contain_text("Alpha")


def test_page_keys_step_like_space_and_arrows_skip_subslides(nbclassic_server, page):
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

    page.keyboard.press("PageDown")
    expect(bravo).to_have_class(VISIBLE)
    page.keyboard.press("PageDown")
    expect(current).to_contain_text("Charlie")
    page.keyboard.press("PageUp")
    expect(current).to_contain_text("Alpha")

    page.keyboard.press("ArrowRight")
    expect(current).to_contain_text("Delta")
    page.keyboard.press("ArrowLeft")
    expect(current).to_contain_text("Alpha")

    # RISE turns off reveal's down arrow, which would otherwise move to Charlie
    page.keyboard.press("ArrowDown")
    page.keyboard.press("PageDown")
    expect(current).to_contain_text("Charlie")


def test_end_and_home_jump_to_the_last_and_first_slides(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Bravo", "subslide"),
        markdown("Charlie", "slide"),
        markdown("Delta", "subslide"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    current = page.locator(CURRENT_SUBSLIDE)

    page.keyboard.press("End")
    expect(current).to_contain_text("Charlie")

    page.keyboard.press("Home")
    expect(current).to_contain_text("Alpha")


def test_w_toggles_the_slide_overview(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide"), markdown("Bravo", "slide")])
    enter_slideshow(page)
    reveal = page.locator("div.reveal")

    page.keyboard.press("w")
    expect(reveal).to_have_class(OVERVIEW)

    page.keyboard.press("w")
    expect(reveal).not_to_have_class(OVERVIEW)


def test_url_hash_follows_the_current_subslide_and_clears_on_exit(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Bravo", "subslide"),
        markdown("Charlie", "slide"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)
    expect(page).to_have_url(re.compile(r"#/slide-0-0$"))

    page.keyboard.press("Space")
    expect(page).to_have_url(re.compile(r"#/slide-0-1$"))

    page.keyboard.press("Space")
    expect(page).to_have_url(re.compile(r"#/slide-1-0$"))

    exit_slideshow(page)
    page.wait_for_function("() => location.hash === ''", timeout=5000)


def test_slideshow_starts_on_the_slide_of_the_selected_cell(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), markdown("Bravo", "slide")]
    nbclassic_server.open_notebook(page, cells)
    page.locator(".cell").nth(1).click()

    enter_slideshow(page)

    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Bravo")


def test_start_slideshow_at_beginning_ignores_the_selected_cell(nbclassic_server, page):
    cells = [markdown("Alpha", "slide"), markdown("Bravo", "slide")]
    metadata = {"rise": {"start_slideshow_at": "beginning"}}
    nbclassic_server.open_notebook(page, cells, metadata=metadata)
    page.locator(".cell").nth(1).click()

    enter_slideshow(page)

    expect(page.locator(CURRENT_SUBSLIDE)).to_contain_text("Alpha")

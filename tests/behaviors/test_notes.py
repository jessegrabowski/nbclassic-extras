from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown


def test_t_opens_a_speaker_view_that_follows_the_slideshow(nbclassic_server, page):
    cells = [
        markdown("Alpha", "slide"),
        markdown("Spoken one", "notes"),
        markdown("Bravo", "slide"),
        markdown("Spoken two", "notes"),
    ]
    nbclassic_server.open_notebook(page, cells)
    enter_slideshow(page)

    with page.expect_popup() as popup_info:
        page.keyboard.press("t")
    notes = popup_info.value.locator(".speaker-controls-notes")
    expect(notes).to_contain_text("Spoken one", timeout=15000)

    page.keyboard.press("Space")
    expect(notes).to_contain_text("Spoken two")
    expect(notes).not_to_contain_text("Spoken one")

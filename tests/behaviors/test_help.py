from playwright.sync_api import expect
from slideshow import enter_slideshow, markdown


def test_help_button_and_question_mark_open_the_shortcut_help(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)
    # nbclassic keeps a closed dialog in the page, hidden
    title = page.locator(".modal-title:visible")

    page.click("#help_b")
    expect(title).to_have_text("Reveal Shortcuts Help")
    expect(page.locator(".modal-body kbd", has_text="Space").first).to_be_visible()

    page.click(".modal-header .close:visible")
    expect(title).to_have_count(0)
    page.keyboard.press("Shift+/")
    expect(title).to_have_text("Reveal Shortcuts Help")


def test_comma_hides_and_shows_the_rise_buttons(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)

    page.keyboard.press(",")
    expect(page.locator("#exit_b")).to_be_hidden()
    expect(page.locator("#help_b")).to_be_hidden()

    page.keyboard.press(",")
    expect(page.locator("#exit_b")).to_be_visible()
    expect(page.locator("#help_b")).to_be_visible()


def test_f_opens_the_fullscreen_help(nbclassic_server, page):
    nbclassic_server.open_notebook(page, [markdown("Alpha", "slide")])
    enter_slideshow(page)

    page.keyboard.press("f")

    expect(page.locator(".modal-title")).to_have_text("Fullscreen Help")

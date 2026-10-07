import os
from pathlib import Path
import shutil
import sys

import nbformat
from PIL import Image, ImageChops
import pytest
from slideshow import enter_slideshow, wait_for_slideshow

NOTEBOOKS = Path(__file__).parent / "notebooks"
BASELINES = Path(__file__).parent / "screenshots" / sys.platform
THEMES = [
    "black",
    "white",
    "league",
    "sky",
    "beige",
    "simple",
    "serif",
    "blood",
    "night",
    "moon",
    "solarized",
]
EXAMPLES = [
    "header-footer",
    "overlay",
    "font-sizes",
    "font-sizes-untampered",
    "showflow",
    "issue-370",
    "issue-546-newlines-in-bullets",
]
# A pixel counts as changed when a channel moves by more than this. Repeated runs on one machine
# differ by at most 2 in a handful of pixels, and a text color change moves 30 or more.
CHANNEL_TOLERANCE = 8
# Share of changed pixels a screenshot may differ from its baseline by, about 180 at 1280x720.
CHANGED_PIXEL_LIMIT = 0.0002


def autolaunches(notebook):
    return any(notebook.metadata.get(key, {}).get("autolaunch") for key in ("rise", "livereveal"))


def assert_first_slide_matches_baseline(page, name, request, autolaunch):
    """Screenshot the first slide and compare it with the stored baseline for this platform."""
    if autolaunch:
        wait_for_slideshow(page)
    else:
        enter_slideshow(page)
    # several themes import their fonts from Google Fonts
    page.wait_for_load_state("networkidle")
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(500)
    actual_path = request.config.cache.mkdir("screenshots") / f"{name}.png"
    page.screenshot(path=actual_path, animations="disabled", caret="hide")

    baseline_path = BASELINES / f"{name}.png"
    if request.config.getoption("--update-screenshots"):
        BASELINES.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(actual_path, baseline_path)
        pytest.skip(f"wrote the {sys.platform} baseline {baseline_path.name}")
    if not baseline_path.exists():
        missing = f"no {sys.platform} baseline; run pytest with --update-screenshots"
        if os.environ.get("CI"):
            pytest.fail(f"{missing}, or take {actual_path.name} from the CI screenshots artifact")
        pytest.skip(missing)

    with Image.open(actual_path) as actual, Image.open(baseline_path) as baseline:
        assert actual.size == baseline.size, f"{name}: screenshot size changed"
        difference = ImageChops.difference(actual.convert("RGB"), baseline.convert("RGB"))
    red, green, blue = difference.split()
    largest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    changed = sum(largest.histogram()[CHANNEL_TOLERANCE + 1 :])
    share = changed / (difference.width * difference.height)
    assert share <= CHANGED_PIXEL_LIMIT, f"{name}: {share:.2%} of pixels changed, see {actual_path}"


@pytest.mark.parametrize("theme", THEMES)
def test_theme_screenshot_matches_baseline(nbclassic_server, page, request, theme):
    notebook = nbformat.read(NOTEBOOKS / "themes-master.ipynb", as_version=4)
    notebook.metadata.setdefault("rise", {})["theme"] = theme
    # as RISE's tests/themes/redo-all.sh does, so each slide names its theme
    for cell in notebook.cells:
        cell.source = cell.source.replace("{theme}", theme)
    name = f"theme-{theme}.ipynb"
    nbformat.write(notebook, nbclassic_server.notebook_dir / name)
    nbclassic_server.open_existing_notebook(page, name)

    assert_first_slide_matches_baseline(page, f"theme-{theme}", request, autolaunches(notebook))


@pytest.mark.parametrize("example", EXAMPLES)
def test_example_screenshot_matches_baseline(nbclassic_server, page, request, example):
    for source in NOTEBOOKS.glob(f"{example}.*"):
        shutil.copyfile(source, nbclassic_server.notebook_dir / source.name)
    nbclassic_server.open_existing_notebook(page, f"{example}.ipynb")
    notebook = nbformat.read(NOTEBOOKS / f"{example}.ipynb", as_version=4)

    assert_first_slide_matches_baseline(page, f"example-{example}", request, autolaunches(notebook))

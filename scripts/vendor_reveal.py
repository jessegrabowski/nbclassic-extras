import argparse
import base64
from dataclasses import dataclass
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

SCRIPTS_DIR = Path(__file__).resolve().parent
PATCH_DIR = SCRIPTS_DIR / "reveal_patches"
DEFAULT_TARGET = SCRIPTS_DIR.parent / "static" / "rise"
VENDORED_DIRS = ["reveal.js", "reveal.js-chalkboard"]
DOWNLOAD_TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class Source:
    url: str
    sha512: str
    copies: dict[str, str]


SOURCES = [
    Source(
        url="https://registry.npmjs.org/reveal.js/-/reveal.js-6.0.2.tgz",
        sha512="JYIg5D9aoxoaLeb84O+OvAwsKWdIavVgEDScxtYEXFCT6t6TQrhNtSgogcjdCpdLsWglhJn3zyE3fUOwiH5KEg==",
        copies={
            "package/LICENSE": "reveal.js/LICENSE",
            "package/dist/reveal.js": "reveal.js/reveal.js",
            "package/dist/reveal.css": "reveal.js/reveal.css",
            "package/dist/theme": "reveal.js/theme",
            "package/dist/plugin/notes.js": "reveal.js/plugin/notes.js",
        },
    ),
    Source(
        url="https://codeload.github.com/rajgoel/reveal.js-plugins/tar.gz/4.6.0",
        sha512="Cbn7E8n17cK/6Hq+qwEginjzlfuq/ukyo2uwcVoXm6xQ8btI1SBS7cjf60mMSFij2jS7szYBG0hklG1icUaujw==",
        copies={"reveal.js-plugins-4.6.0/chalkboard": "reveal.js-chalkboard"},
    ),
]

PATCHES = ["notes-plugin.patch", "chalkboard.patch"]


def download(source: Source) -> bytes:
    with urllib.request.urlopen(source.url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        archive = response.read()
    digest = base64.b64encode(hashlib.sha512(archive).digest()).decode()
    if digest != source.sha512:
        raise ValueError(f"{source.url} has sha512 {digest}, expected {source.sha512}")
    return archive


def extract(archive: bytes, copies: dict[str, str], target: Path) -> None:
    with (
        tempfile.TemporaryDirectory() as scratch,
        tarfile.open(fileobj=io.BytesIO(archive)) as tar,
    ):
        tar.extractall(path=scratch, filter="data")
        for source, destination in copies.items():
            copy(source=Path(scratch) / source, destination=target / destination)


def copy(source: Path, destination: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def apply_patch(patch: Path, target: Path) -> None:
    command = ["patch", "--forward", "--strip=1", "--silent", f"--directory={target}"]
    subprocess.run([*command, f"--input={patch}"], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Vendor reveal.js and chalkboard into RISE.")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    target = parser.parse_args().target

    for name in VENDORED_DIRS:
        shutil.rmtree(target / name, ignore_errors=True)
    for source in SOURCES:
        extract(archive=download(source), copies=source.copies, target=target)
    for name in PATCHES:
        apply_patch(patch=PATCH_DIR / name, target=target)


if __name__ == "__main__":
    main()

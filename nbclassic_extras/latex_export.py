from traitlets.config import Config

# Cell tags that remove content when the server converts a notebook, as File > Download as does.
# They follow Jupyter Book's names, so a tagged notebook renders the same under that toolchain.
REMOVAL_TAGS = {
    "remove_cell_tags": {"remove-cell"},
    "remove_input_tags": {"remove-input"},
    "remove_all_outputs_tags": {"remove-output"},
}


def add_removal_tags(config: Config) -> None:
    """Give each TagRemovePreprocessor tag set in ``config`` its default, unless already set."""
    preprocessor = config.TagRemovePreprocessor
    for name, tags in REMOVAL_TAGS.items():
        if name not in preprocessor:
            preprocessor[name] = set(tags)


# jupyter_server_config.d is read only for jpserver_extensions, so a TagRemovePreprocessor section
# there never reaches the exporter. The nbconvert handler builds each exporter from the server's
# config object, so setting the tags on it here applies them to every later conversion.
def _load_jupyter_server_extension(serverapp):
    add_removal_tags(serverapp.config)

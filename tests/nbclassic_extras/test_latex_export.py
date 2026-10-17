from traitlets.config import Config

from nbclassic_extras.latex_export import add_removal_tags


def test_removal_tags_fill_unset_tag_sets_and_keep_the_users():
    config = Config({"TagRemovePreprocessor": {"remove_input_tags": {"hide"}}})

    add_removal_tags(config)

    assert config.TagRemovePreprocessor == {
        "remove_cell_tags": {"remove-cell"},
        "remove_input_tags": {"hide"},
        "remove_all_outputs_tags": {"remove-output"},
    }

import urllib.request

import nbformat
from nbformat.v4 import new_code_cell, new_notebook, new_output


def tagged_cell(source, output_text, tags):
    return new_code_cell(
        source=source,
        metadata={"tags": tags},
        outputs=[new_output(output_type="stream", name="stdout", text=output_text)],
    )


def test_download_as_latex_drops_what_the_removal_tags_name(nbclassic_server):
    notebook = new_notebook(
        cells=[
            tagged_cell(source="print('kept source')", output_text="kept output", tags=[]),
            tagged_cell(
                source="print('dropped cell source')",
                output_text="dropped cell output",
                tags=["remove-cell"],
            ),
            tagged_cell(
                source="print('hidden source')", output_text="shown output", tags=["remove-input"]
            ),
            tagged_cell(
                source="print('shown source')", output_text="hidden output", tags=["remove-output"]
            ),
        ]
    )
    nbformat.write(notebook, nbclassic_server.notebook_dir / "tagged.ipynb")

    # the URL the classic UI's File > Download as > LaTeX requests
    with urllib.request.urlopen(nbclassic_server.url("nbconvert/latex/tagged.ipynb")) as response:
        tex = response.read().decode()

    for present in ["kept source", "kept output", "shown output", "shown source"]:
        assert present in tex
    for absent in ["dropped cell source", "dropped cell output", "hidden source", "hidden output"]:
        assert absent not in tex

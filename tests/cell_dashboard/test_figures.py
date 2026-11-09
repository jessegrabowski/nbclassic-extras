import ast
import base64
from pathlib import Path
import struct

from jupyter_client.manager import start_new_kernel
import pytest

HELPER = Path(__file__).resolve().parents[2] / "static" / "cell_dashboard" / "figures.py"
MODULE = "__import__('sys').modules['cell_dashboard_figures']"
CELL = "c0ffee01"
TIMEOUT = 30


class Kernel:
    """A real IPython kernel, driven the way the notebook drives it."""

    def __init__(self, client):
        self.client = client

    def run(self, code):
        """Run code as a cell and return the outputs it showed."""
        message_id = self.client.execute(code)
        self.client.get_shell_msg(timeout=TIMEOUT)
        return self.outputs_of(message_id)

    def outputs_of(self, message_id):
        outputs = []
        while True:
            message = self.client.get_iopub_msg(timeout=TIMEOUT)
            if message["parent_header"].get("msg_id") != message_id:
                continue
            kind = message["msg_type"]
            if kind == "status" and message["content"]["execution_state"] == "idle":
                return outputs
            if kind in ("display_data", "execute_result", "error", "stream"):
                outputs.append(message["content"] | {"output_type": kind})

    def ask(self, expression):
        """Evaluate expression as a silent user expression and return its value."""
        message_id = self.client.execute("", silent=True, user_expressions={"answer": expression})
        reply = self.client.get_shell_msg(timeout=TIMEOUT)
        self.outputs_of(message_id)
        result = reply["content"]["user_expressions"]["answer"]
        assert result["status"] == "ok", result
        # the helper answers in JSON, and plain values come back as their repr
        if "application/json" in result["data"]:
            return result["data"]["application/json"]
        return ast.literal_eval(result["data"]["text/plain"])

    def load_helper(self):
        self.run(
            "import sys, types\n"
            "module = types.ModuleType('cell_dashboard_figures')\n"
            f"exec(compile({HELPER.read_text()!r}, 'figures.py', 'exec'), module.__dict__)\n"
            "sys.modules['cell_dashboard_figures'] = module\n"
            "del sys, types, module"
        )
        return self.ask(f"{MODULE}.install()")


@pytest.fixture
def kernel():
    manager, client = start_new_kernel(kernel_name="python3")
    try:
        yield Kernel(client)
    finally:
        client.stop_channels()
        manager.shutdown_kernel(now=True)


def figure_ids(outputs):
    return [
        output["metadata"]["cell_dashboard"]["figure"]
        for output in outputs
        if "cell_dashboard" in output.get("metadata", {})
    ]


def png_size(encoded):
    width, height = struct.unpack(">II", base64.b64decode(encoded)[16:24])
    return width, height


PLOT = "import matplotlib.pyplot as plt\nfig, ax = plt.subplots(figsize=(4, 3))\nax.plot([1, 2, 3])"


def run_armed(kernel, code, cell=CELL):
    kernel.ask(f"{MODULE}.arm({cell!r})")
    return kernel.run(code)


def test_setup_leaves_matplotlib_unimported(kernel):
    assert kernel.load_helper() == {"installed": True}

    assert kernel.ask("'matplotlib' in __import__('sys').modules") is False
    assert kernel.ask(f"{MODULE}.install()") == {"installed": True}


def test_an_armed_cell_marks_its_figure_and_keeps_its_picture(kernel):
    kernel.load_helper()

    outputs = run_armed(kernel, PLOT)

    [shown] = [output for output in outputs if "image/png" in output.get("data", {})]
    assert len(figure_ids([shown])) == 1


def test_an_unarmed_cell_shows_its_figure_unmarked_and_kept_nowhere(kernel):
    kernel.load_helper()

    outputs = kernel.run(PLOT)

    assert any("image/png" in output.get("data", {}) for output in outputs)
    assert figure_ids(outputs) == []
    assert kernel.ask(f"len({MODULE}.keeper.figures)") == 0


def test_a_render_draws_the_figure_at_the_size_asked_and_restores_its_own(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))

    for width, height in [(1600, 450), (500, 900)]:
        answer = kernel.ask(f"{MODULE}.render({figure_id!r}, {width}, {height})")
        assert (answer["width"], answer["height"]) == (width, height)
        assert png_size(answer["png"]) == (width, height)

    assert kernel.ask("fig.get_size_inches().tolist()") == [4.0, 3.0]


def test_a_render_keeps_its_size_when_the_inline_backend_sets_a_dpi(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))
    kernel.run("%config InlineBackend.print_figure_kwargs = {'dpi': 200, 'bbox_inches': 'tight'}")

    answer = kernel.ask(f"{MODULE}.render({figure_id!r}, 400, 300)")

    assert png_size(answer["png"]) == (400, 300)


def test_a_render_keeps_the_longest_side_in_bounds(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))

    answer = kernel.ask(f"{MODULE}.render({figure_id!r}, 7680, 4320)")

    assert png_size(answer["png"]) == (3840, 2160)


def test_a_figure_changed_by_a_later_cell_is_refused(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))
    kernel.run("x = 1")
    assert "png" in kernel.ask(f"{MODULE}.render({figure_id!r}, 400, 300)")

    kernel.run("ax.plot([3, 2, 1])")

    assert kernel.ask(f"{MODULE}.render({figure_id!r}, 400, 300)") == {
        "error": "changed since it was shown"
    }


def test_a_closed_and_deleted_figure_still_renders(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))

    kernel.run("plt.close('all')\ndel fig, ax")

    assert png_size(kernel.ask(f"{MODULE}.render({figure_id!r}, 320, 240)")["png"]) == (320, 240)


def test_a_rerun_replaces_the_figures_of_its_cell(kernel):
    kernel.load_helper()
    [first] = figure_ids(run_armed(kernel, PLOT))

    [second] = figure_ids(run_armed(kernel, PLOT))

    assert first != second
    assert kernel.ask(f"{MODULE}.render({first!r}, 400, 300)") == {"error": "unknown figure"}
    assert "png" in kernel.ask(f"{MODULE}.render({second!r}, 400, 300)")


def test_a_cell_keeps_only_its_last_few_figures(kernel):
    kernel.load_helper()
    loop = (
        "import matplotlib.pyplot as plt\n"
        "from IPython.display import display\n"
        "for _ in range(12):\n"
        "    figure, axes = plt.subplots()\n"
        "    display(figure)\n"
        "    plt.close(figure)"
    )

    ids = figure_ids(run_armed(kernel, loop))

    assert len(ids) == 12
    assert kernel.ask(f"sorted({MODULE}.keeper.figures) == sorted({ids[-8:]!r})") is True


def test_a_figure_shown_twice_in_a_run_answers_to_its_latest_id(kernel):
    kernel.load_helper()
    twice = PLOT + "\nfrom IPython.display import display\ndisplay(fig)\ndisplay(fig)"

    first, *rest = figure_ids(run_armed(kernel, twice))

    assert kernel.ask(f"{MODULE}.render({first!r}, 400, 300)") == {"error": "unknown figure"}
    assert "png" in kernel.ask(f"{MODULE}.render({rest[-1]!r}, 400, 300)")


def test_a_failing_keeper_leaves_the_cell_its_picture_and_no_traceback(kernel):
    kernel.load_helper()
    kernel.run(f"{MODULE}.keeper.keep = lambda figure: 1 / 0")

    outputs = run_armed(kernel, PLOT)

    assert any("image/png" in output.get("data", {}) for output in outputs)
    assert [output for output in outputs if output["output_type"] == "error"] == []


@pytest.mark.parametrize(
    ("figure_id", "error"),
    [("nope", "not a figure id"), ("0" * 32, "unknown figure")],
    ids=["malformed", "unknown"],
)
def test_a_render_of_a_figure_not_kept_gets_an_error(kernel, figure_id, error):
    kernel.load_helper()

    assert kernel.ask(f"{MODULE}.render({figure_id!r}, 400, 300)") == {"error": error}


def test_a_render_at_an_empty_size_gets_an_error(kernel):
    kernel.load_helper()
    [figure_id] = figure_ids(run_armed(kernel, PLOT))

    assert kernel.ask(f"{MODULE}.render({figure_id!r}, 0, 300)") == {"error": "not a size"}


def test_arming_refuses_anything_but_a_cell_id(kernel):
    kernel.load_helper()

    message_id = kernel.client.execute(
        "", silent=True, user_expressions={"answer": f"{MODULE}.arm('x\\'); import os')"}
    )
    reply = kernel.client.get_shell_msg(timeout=TIMEOUT)
    kernel.outputs_of(message_id)

    assert reply["content"]["user_expressions"]["answer"]["status"] == "error"
    assert kernel.ask(f"{MODULE}.keeper.armed_cell") is None

# cell_dashboard's kernel helper: keeps the matplotlib figures that linked cells display and draws
# them again at the size of the pane showing them.
#
# The notebook sends this file's source to the kernel and runs it as the module
# cell_dashboard_figures, so it never has to be installed in the kernel's environment. A kernel
# holding a different source replaces it, after uninstall() takes the old one's hooks out.
# Everything it offers the notebook goes through user expressions on silent executes, which leave
# the execution count and the cells' outputs alone, and every answer is a JSON object.
#
# The helper never imports matplotlib itself. Its formatter is registered by the figure class's
# name, so a kernel without matplotlib loads it and simply never sees a figure.
import base64
import io
import re
import time
import uuid

FIGURES_PER_CELL = 8
LONGEST_SIDE = 3840
METADATA_KEY = "cell_dashboard"
CELL_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
FIGURE_ID = re.compile(r"[0-9a-f]{32}")


class Answer:
    """A reply to the notebook, which IPython shows as JSON in a user expression's result."""

    def __init__(self, **fields):
        self.fields = fields

    def _repr_json_(self):
        return self.fields

    def __repr__(self):
        return f"Answer({self.fields!r})"


class FigureKeeper:
    """Keeps the figures shown by the cell the notebook armed, under ids it can ask for later."""

    def __init__(self):
        self.armed_cell = None
        self.just_shown = []
        self.ids_by_cell = {}
        self.figures = {}

    def arm(self, cell_id):
        # a run replaces whatever the cell showed before
        self.forget(cell_id)
        self.armed_cell = cell_id
        self.just_shown = []

    def forget(self, cell_id):
        if not isinstance(cell_id, str) or CELL_ID.fullmatch(cell_id) is None:
            raise ValueError(f"not a cell id: {cell_id!r}")
        for figure_id in self.ids_by_cell.pop(cell_id, []):
            self.figures.pop(figure_id, None)

    def format_figure(self, figure, include=None, exclude=None):
        # an error here would put a traceback in the user's cell, beside the figure
        try:
            return self.keep(figure)
        except Exception:
            return {}

    def keep(self, figure):
        if self.armed_cell is None:
            return {}
        cell_ids = self.ids_by_cell.setdefault(self.armed_cell, [])
        # a figure shown twice in one run answers to its latest id only
        for figure_id in [kept for kept in cell_ids if self.figures.get(kept) is figure]:
            cell_ids.remove(figure_id)
            del self.figures[figure_id]
        figure_id = uuid.uuid4().hex
        cell_ids.append(figure_id)
        self.figures[figure_id] = figure
        # a loop that shows many figures keeps only the last few
        while len(cell_ids) > FIGURES_PER_CELL:
            del self.figures[cell_ids.pop(0)]
        self.just_shown.append(figure)
        return {}, {METADATA_KEY: {"figure": figure_id}}

    # drawing for display leaves a figure marked stale, so the mark only means a change once the
    # display is over
    def after_display(self):
        for figure in self.just_shown:
            figure.stale = False
        self.just_shown = []

    def after_cell(self, result=None):
        self.armed_cell = None
        self.just_shown = []

    def render(self, figure_id, width, height):
        started = time.perf_counter()
        if not isinstance(figure_id, str) or FIGURE_ID.fullmatch(figure_id) is None:
            return Answer(error="not a figure id")
        figure = self.figures.get(figure_id)
        if figure is None:
            return Answer(error="unknown figure")
        if figure.stale:
            return Answer(error="changed since it was shown")
        try:
            width, height = fitted_size(width=width, height=height)
        except (TypeError, ValueError):
            return Answer(error="not a size")
        png = drawn_at(figure=figure, width=width, height=height)
        return Answer(png=png,
                      width=width,
                      height=height,
                      seconds=time.perf_counter() - started)


def fitted_size(width, height):
    """Return the requested size in whole pixels, shrunk to keep the longest side in bounds."""
    width = int(width)
    height = int(height)
    if width < 1 or height < 1:
        raise ValueError(f"not a size: {width}x{height}")
    shrink = min(1, LONGEST_SIDE / max(width, height))
    return max(1, round(width * shrink)), max(1, round(height * shrink))


def inline_figure_options():
    """Return the inline backend's savefig options, less those that would change the size."""
    try:
        from matplotlib_inline.config import InlineBackend
    except ImportError:
        return {}
    options = dict(InlineBackend.instance().print_figure_kwargs)
    # the render sets the resolution and format itself, and a tight crop would trim the size
    for name in ("bbox_inches", "dpi", "format"):
        options.pop(name, None)
    return options


def drawn_at(figure, width, height):
    """Return the figure drawn as a base64 PNG of exactly width x height pixels."""
    dpi = figure.dpi
    original_size = figure.get_size_inches().copy()
    buffer = io.BytesIO()
    try:
        figure.set_size_inches(width / dpi, height / dpi, forward=False)
        figure.savefig(buffer, format="png", dpi=dpi, **inline_figure_options())
    finally:
        figure.set_size_inches(original_size, forward=False)
        # restoring the size marks the figure stale, though it looks as it did
        figure.stale = False
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def settling(display_format):
    """Wrap a display formatter's format so the figures it just drew read as unchanged."""

    def format_and_settle(obj, include=None, exclude=None):
        formatted = display_format(obj, include=include, exclude=exclude)
        # an error here would put a traceback in the user's cell, beside the figure
        try:
            keeper.after_display()
        except Exception:
            pass
        return formatted

    return format_and_settle


keeper = FigureKeeper()
installed_in = None


def install():
    """Hook the keeper into this kernel's IPython, once, and say whether that worked."""
    global installed_in
    try:
        from IPython import get_ipython
    except ImportError:
        return Answer(installed=False, reason="no IPython")
    shell = get_ipython()
    if shell is None:
        return Answer(installed=False, reason="no IPython shell")
    if installed_in is not shell:
        display_formatter = shell.display_formatter
        display_formatter.mimebundle_formatter.for_type_by_name("matplotlib.figure",
                                                                "Figure",
                                                                keeper.format_figure)
        display_formatter.format = settling(display_formatter.format)
        shell.events.register("post_run_cell", keeper.after_cell)
        installed_in = shell
    return Answer(installed=True)


def uninstall():
    """Take the keeper's hooks back out of the IPython it was installed in."""
    global installed_in
    shell = installed_in
    if shell is None:
        return
    display_formatter = shell.display_formatter
    # a formatter that already met a figure keeps its printer by class, out of reach of a new name
    display_formatter.mimebundle_formatter.pop("matplotlib.figure.Figure", None)
    display_formatter.__dict__.pop("format", None)
    shell.events.unregister("post_run_cell", keeper.after_cell)
    installed_in = None


def arm(cell_id):
    keeper.arm(cell_id)
    return Answer(armed=cell_id)


def forget(cell_id):
    keeper.forget(cell_id)
    return Answer(forgot=cell_id)


def render(figure_id, width, height):
    return keeper.render(figure_id=figure_id, width=width, height=height)

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadDashboardPage } = require("../harness");

const CHANNEL = "cell_dashboard:work/fit.ipynb";

function pane(outputs, { trusted = true, id = "cell-a", index = 0, title = "fit()" } = {}) {
    return {
        type: "pane",
        id: id,
        index: index,
        title: title,
        outputs: outputs,
        trusted: trusted,
    };
}

function display(data) {
    return { output_type: "display_data", data: data, metadata: {} };
}

test("the page listens on the channel in its address and announces itself", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    assert.equal(page.channel.name, CHANNEL);
    assert.deepEqual(page.channel.posted, [{ type: "ready" }]);
});

test("a stream shows as text under the cell's title", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    page.channel.deliver(pane([{ output_type: "stream", name: "stdout", text: "one\n" }]));

    assert.equal(page.title(), "fit()");
    assert.equal(page.outputs().querySelector("pre").textContent, "one\n");
});

test("a traceback shows as text without its terminal colors", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const traceback = ["\u001b[0;31mValueError\u001b[0m: bad", "line 2"];

    page.channel.deliver(pane([{ output_type: "error", traceback: traceback }]));

    assert.equal(page.outputs().querySelector("pre").textContent, "ValueError: bad\nline 2");
});

for (const [mime, source] of [
    ["image/png", "data:image/png;base64,AAAA"],
    ["image/jpeg", "data:image/jpeg;base64,AAAA"],
    ["image/svg+xml", "data:image/svg+xml,AAAA"],
    ["image/gif", "data:image/gif;base64,AAAA"],
]) {
    test(`${mime} shows as an image, trusted or not`, (t) => {
        const page = loadDashboardPage({ channelName: CHANNEL });
        t.after(page.close);

        const data = { [mime]: "AAAA", "text/plain": "<Figure>" };
        page.channel.deliver(pane([display(data)], { trusted: false }));

        assert.equal(page.outputs().querySelector("img").getAttribute("src"), source);
    });
}

for (const [name, text] of [
    ["private cursor sequences", "\u001b[?25lsampling\u001b[?25h"],
    ["a hyperlink", "\u001b]8;;https://example.com\u0007sampling\u001b]8;;\u0007"],
    [
        "a hyperlink ended the long way",
        "\u001b]8;;https://example.com\u001b\\sampling\u001b]8;;\u001b\\",
    ],
]) {
    test(`a stream drops ${name}`, (t) => {
        const page = loadDashboardPage({ channelName: CHANNEL });
        t.after(page.close);

        page.channel.deliver(pane([{ output_type: "stream", name: "stderr", text: text }]));

        assert.equal(page.outputs().querySelector("pre").textContent, "sampling");
    });
}

test("trusted HTML that needs a script falls back to its text", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = {
        "text/html": "<div id='plot'></div><script>draw()</script>",
        "text/plain": "<Plot>",
    };

    page.channel.deliver(pane([display(data)]));

    assert.equal(page.outputs().querySelector("#plot"), null);
    assert.equal(page.outputs().querySelector("pre").textContent, "<Plot>");
});

test("trusted HTML shows as HTML", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "text/html": "<table><tr><td>1</td></tr></table>", "text/plain": "frame" };

    page.channel.deliver(pane([display(data)]));

    assert.equal(page.outputs().querySelector("td").textContent, "1");
});

test("untrusted HTML falls back to its text", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "text/html": "<table><tr><td>1</td></tr></table>", "text/plain": "frame" };

    page.channel.deliver(pane([display(data)], { trusted: false }));

    assert.equal(page.outputs().querySelector("td"), null);
    assert.equal(page.outputs().querySelector("pre").textContent, "frame");
});

test("a JavaScript output falls back to its text", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "application/javascript": "alert(1)", "text/plain": "<Plot>" };

    page.channel.deliver(pane([display(data)]));

    assert.equal(page.outputs().querySelector("pre").textContent, "<Plot>");
});

test("an output with no type the page can show is left out", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const stream = { output_type: "stream", name: "stdout", text: "one\n" };

    page.channel.deliver(pane([display({ "application/javascript": "alert(1)" }), stream]));

    assert.equal(page.outputs().children.length, 1);
});

function dragEvent(page, type, target) {
    const event = new page.document.defaultView.Event(type, { bubbles: true, cancelable: true });
    event.dataTransfer = { setData() {} };
    target.dispatchEvent(event);
}

function twoPanes(page) {
    page.channel.deliver(pane([], { id: "cell-a" }));
    page.channel.deliver(pane([], { id: "cell-b" }));
    return [...page.document.querySelectorAll(".pane")];
}

function previews(page) {
    return page.document.querySelectorAll("[data-drop]").length;
}

test("a pane being dragged over shows a preview", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [first, second] = twoPanes(page);

    dragEvent(page, "dragstart", first.querySelector(".pane_title"));
    dragEvent(page, "dragover", second);

    assert.equal(previews(page), 1);
});

test("a drop clears a preview left on another pane", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [first, second] = twoPanes(page);
    dragEvent(page, "dragstart", first.querySelector(".pane_title"));
    dragEvent(page, "dragover", first);
    dragEvent(page, "dragover", second);

    dragEvent(page, "drop", second);

    assert.equal(previews(page), 0);
});

test("a drag that ends without a drop clears its preview", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [first, second] = twoPanes(page);
    const title = first.querySelector(".pane_title");
    dragEvent(page, "dragstart", title);
    dragEvent(page, "dragover", second);

    dragEvent(page, "dragend", title);

    assert.equal(previews(page), 0);
});

test("a drop just after a dragleave still splits along an edge", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [first, second] = twoPanes(page);
    dragEvent(page, "dragstart", first.querySelector(".pane_title"));
    dragEvent(page, "dragover", second);
    dragEvent(page, "dragleave", second);

    dragEvent(page, "drop", second);

    assert.equal(page.document.querySelectorAll(".split.row").length, 1);
});

test("a dragover that arrives after the drag ended shows no preview", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [first, second] = twoPanes(page);
    const title = first.querySelector(".pane_title");
    dragEvent(page, "dragstart", title);
    dragEvent(page, "dragend", title);

    dragEvent(page, "dragover", second);

    assert.equal(previews(page), 0);
});

test("the hint leaves when the first pane arrives", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    assert.equal(page.document.getElementById("hint").hidden, false);

    page.channel.deliver(pane([]));

    assert.equal(page.document.getElementById("hint").hidden, true);
});

test("each cell gets its own pane, and the panes sit around a divider", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    page.channel.deliver(pane([], { id: "cell-a" }));
    page.channel.deliver(pane([], { id: "cell-b" }));

    assert.equal(page.document.querySelectorAll(".pane").length, 2);
    assert.equal(page.document.querySelectorAll(".split > .divider").length, 1);
});

test("a message that names an edge places a new pane there", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([], { id: "cell-a" }));

    page.channel.deliver({ ...pane([], { id: "cell-b" }), edge: "bottom" });

    assert.equal(page.document.querySelectorAll(".split.column").length, 1);
});

test("a named edge leaves a pane that already exists where it is", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    twoPanes(page);

    page.channel.deliver({ ...pane([], { id: "cell-b" }), edge: "bottom" });

    assert.equal(page.document.querySelectorAll(".split.row").length, 1);
    assert.equal(page.document.querySelectorAll(".split.column").length, 0);
});

test("a new message for the same cell keeps the pane element", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([]));
    const first = page.document.querySelector(".pane");

    page.channel.deliver(pane([]));

    assert.equal(page.document.querySelector(".pane"), first);
    assert.equal(page.document.querySelectorAll(".pane").length, 1);
});

function shownIndex(page) {
    return page.document.querySelector(".pane_title").getAttribute("data-cell-index");
}

test("a pane shows its cell's index, and zero counts", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    page.channel.deliver(pane([], { index: 0 }));

    assert.equal(shownIndex(page), "0");
});

test("new indices update a pane", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([], { id: "cell-a", index: 3 }));

    page.channel.deliver({ type: "indices", indices: [["cell-a", 7]] });

    assert.equal(shownIndex(page), "7");
});

test("a pane whose cell was deleted stops showing an index", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([], { id: "cell-a", index: 3 }));

    page.channel.deliver({ type: "indices", indices: [["cell-a", null]] });

    assert.equal(shownIndex(page), null);
});

test("indices for a closed pane are ignored", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    page.channel.deliver({ type: "indices", indices: [["cell-a", 2]] });

    assert.equal(page.document.querySelectorAll(".pane").length, 0);
});

test("a pane whose cell is gone is marked until the cell returns", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([], { id: "cell-a" }));
    const shown = page.document.querySelector(".pane");

    page.channel.deliver({ type: "indices", indices: [["cell-a", null]] });
    assert.equal(shown.classList.contains("pane_disconnected"), true);

    page.channel.deliver({ type: "indices", indices: [["cell-a", 4]] });
    assert.equal(shown.classList.contains("pane_disconnected"), false);
});

test("a notebook that announces itself gets the ids of every pane", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    twoPanes(page);
    page.channel.posted.length = 0;

    page.channel.deliver({ type: "hello" });

    assert.deepEqual(page.channel.posted, [{ type: "panes", ids: ["cell-a", "cell-b"] }]);
});

test("the arrangement is stored for the notebook", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    twoPanes(page);

    assert.deepEqual(page.storedLayout(), {
        direction: "row",
        ratio: 0.5,
        first: { pane: "cell-a" },
        second: { pane: "cell-b" },
    });
});

const STACKED = {
    direction: "column",
    ratio: 0.3,
    first: { pane: "cell-a" },
    second: { pane: "cell-b" },
};

test("returning panes go back to the stored arrangement", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, storedLayout: STACKED });
    t.after(page.close);

    page.channel.deliver(pane([], { id: "cell-b", title: "b" }));
    assert.equal(page.document.querySelectorAll(".split").length, 0);

    page.channel.deliver(pane([], { id: "cell-a", title: "a" }));
    const split = page.document.querySelector(".split.column");
    assert.equal(split.firstElementChild.querySelector(".pane_title").textContent, "a");
    assert.equal(split.firstElementChild.style.flex, "0.3 1 0px");
});

test("a pane outside the stored arrangement ends the restore", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, storedLayout: STACKED });
    t.after(page.close);

    page.channel.deliver(pane([], { id: "cell-c" }));
    page.channel.deliver(pane([], { id: "cell-a" }));

    assert.equal(page.document.querySelectorAll(".split.column").length, 0);
    assert.equal(page.document.querySelectorAll(".split.row").length, 1);
});

test("the jump button asks the notebook for its own pane's cell", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const [, second] = twoPanes(page);
    page.channel.posted.length = 0;

    second.querySelector(".pane_button[title^='jump']").click();

    assert.deepEqual(page.channel.posted, [{ type: "jump", id: "cell-b" }]);
});

test("closing a pane removes it and tells the notebook to unlink its cell", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([], { id: "cell-a" }));
    page.channel.deliver(pane([], { id: "cell-b" }));
    page.channel.posted.length = 0;

    page.document.querySelector(".pane_button[title^='close']").click();

    assert.equal(page.document.querySelectorAll(".pane").length, 1);
    assert.equal(page.document.querySelectorAll(".split").length, 0);
    assert.deepEqual(page.channel.posted, [{ type: "unlink", id: "cell-a" }]);
});

test("closing the last pane brings the hint back", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([]));

    page.document.querySelector(".pane_button[title^='close']").click();

    assert.equal(page.document.querySelectorAll(".pane").length, 0);
    assert.equal(page.document.getElementById("hint").hidden, false);
});

test("a closed cell sent again gets a new pane", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver(pane([]));
    page.document.querySelector(".pane_button[title^='close']").click();

    page.channel.deliver(pane([]));

    assert.equal(page.document.querySelectorAll(".pane").length, 1);
});

test("a new message replaces the pane's outputs", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const stream = { output_type: "stream", name: "stdout", text: "one\n" };
    page.channel.deliver(pane([stream, stream]));

    page.channel.deliver(pane([]));

    assert.equal(page.outputs().children.length, 0);
});

const FIGURE = "0123456789abcdef0123456789abcdef";

function plot(figure = FIGURE) {
    return {
        output_type: "display_data",
        data: { "image/png": "AAAA", "text/plain": "<Figure>" },
        metadata: { cell_dashboard: { figure: figure } },
    };
}

// jsdom lays nothing out, so every element reports one size, at twice the pixel density, and the
// returned function changes that size
function withLayout(page, width = 400, height = 300) {
    const window = page.document.defaultView;
    const size = { width: width, height: height };
    Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => size.width });
    Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => size.height });
    window.devicePixelRatio = 2;
    return (newWidth, newHeight) => Object.assign(size, { width: newWidth, height: newHeight });
}

function renderRequests(page) {
    return page.channel.posted.filter(({ type }) => type === "render");
}

const AUTO = ["cell-a", "cell-b"];

test("a lone plot with a figure id asks to be drawn at its pane size", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);

    page.channel.deliver(pane([plot()]));

    assert.deepEqual(renderRequests(page),
                     [{ type: "render", figure: FIGURE, width: 800, height: 600 }]);
});

test("the one plot beside text asks to be drawn at the size it has", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    const result = { output_type: "execute_result", data: { "text/plain": "[<Line2D>]" } };

    page.channel.deliver(pane([result, plot()]));

    assert.deepEqual(renderRequests(page),
                     [{ type: "render", figure: FIGURE, width: 800, height: 600 }]);
});

test("two plots in a pane, or a plot without a usable id, ask for nothing", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);

    const second = plot("fedcba9876543210fedcba9876543210");
    page.channel.deliver(pane([plot(), second], { id: "cell-a" }));
    page.channel.deliver(pane([plot("not-an-id")], { id: "cell-b" }));

    assert.deepEqual(renderRequests(page), []);
});

test("a size already asked for is not asked again, and a new one is", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    const resize = withLayout(page);
    page.channel.deliver(pane([plot()]));

    page.channel.deliver(pane([], { id: "cell-b" }));
    assert.equal(renderRequests(page).length, 1);

    resize(200, 300);
    page.channel.deliver(pane([], { id: "cell-c" }));
    assert.deepEqual(renderRequests(page).at(-1),
                     { type: "render", figure: FIGURE, width: 400, height: 600 });
});

test("a drawing replaces the plot it was asked for", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));

    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });

    assert.equal(page.outputs().querySelector("img").getAttribute("src"),
                 "data:image/png;base64,BBBB");
    assert.equal(page.document.querySelector(".pane_redraw").hidden, true);
});

test("a slow drawing stops asking on its own and offers a redraw button", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    const resize = withLayout(page);
    page.channel.deliver(pane([plot()], { id: "cell-a" }));
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: true });
    const redraw = page.document.querySelector(".pane_redraw");
    assert.equal(redraw.hidden, false);
    page.channel.posted.length = 0;

    resize(200, 300);
    page.channel.deliver(pane([], { id: "cell-b" }));
    assert.deepEqual(renderRequests(page), []);

    redraw.click();
    assert.equal(renderRequests(page).length, 1);
});

test("a slow plot's pane waits to be asked after its cell runs again", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: true });
    page.channel.posted.length = 0;

    page.channel.deliver(pane([plot("fedcba9876543210fedcba9876543210")]));

    assert.deepEqual(renderRequests(page), []);
    assert.equal(page.document.querySelector(".pane_redraw").hidden, false);
});

test("a refused plot is never asked for again", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    const resize = withLayout(page);
    page.channel.deliver(pane([plot()], { id: "cell-a" }));
    page.channel.deliver({ type: "render_failed", figure: FIGURE, error: "changed" });
    page.channel.posted.length = 0;

    resize(200, 300);
    page.channel.deliver(pane([], { id: "cell-b" }));

    assert.deepEqual(renderRequests(page), []);
    assert.equal(page.outputs().querySelector("img").getAttribute("src"),
                 "data:image/png;base64,AAAA");
});

function paneButtons(page) {
    const header = page.document.querySelector(".pane_header");
    return {
        auto: header.querySelector(".pane_auto"),
        redraw: header.querySelector(".pane_redraw"),
        reset: header.querySelector(".pane_reset"),
    };
}

test("a new pane keeps its drawing and offers the auto and redraw buttons", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const resize = withLayout(page);

    page.channel.deliver(pane([{ output_type: "stream", name: "stdout", text: "fit\n" }]));
    assert.equal(paneButtons(page).auto.hidden, true);

    page.channel.deliver(pane([plot()], { id: "cell-a" }));
    resize(200, 300);
    page.channel.deliver(pane([], { id: "cell-b" }));
    assert.deepEqual(renderRequests(page), []);
    assert.equal(paneButtons(page).auto.hidden, false);
    assert.equal(paneButtons(page).auto.getAttribute("aria-pressed"), "false");
    assert.equal(paneButtons(page).redraw.hidden, false);

    paneButtons(page).redraw.click();
    assert.equal(renderRequests(page).length, 1);
});

test("turning auto on asks for a drawing at once and hides the redraw button", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));

    paneButtons(page).auto.click();

    assert.deepEqual(renderRequests(page),
                     [{ type: "render", figure: FIGURE, width: 800, height: 600 }]);
    assert.equal(paneButtons(page).auto.getAttribute("aria-pressed"), "true");
    assert.equal(paneButtons(page).redraw.hidden, true);
});

test("turning auto off again stops redraws", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    const resize = withLayout(page);
    page.channel.deliver(pane([plot()], { id: "cell-a" }));

    paneButtons(page).auto.click();
    page.channel.posted.length = 0;
    resize(200, 300);
    page.channel.deliver(pane([], { id: "cell-b" }));

    assert.equal(paneButtons(page).auto.getAttribute("aria-pressed"), "false");
    assert.deepEqual(renderRequests(page), []);
});

test("reset puts back the cell's drawing and offers itself only after a redraw", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));
    const image = page.outputs().querySelector("img");
    assert.equal(paneButtons(page).reset.hidden, true);

    paneButtons(page).redraw.click();
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });
    assert.equal(paneButtons(page).reset.hidden, false);

    paneButtons(page).reset.click();
    assert.equal(image.getAttribute("src"), "data:image/png;base64,AAAA");
    assert.equal(paneButtons(page).reset.hidden, true);
});

test("a drawing that arrives after a reset is dropped", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));
    paneButtons(page).redraw.click();
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });
    paneButtons(page).redraw.click();

    paneButtons(page).reset.click();
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "CCCC", slow: false });

    assert.equal(page.outputs().querySelector("img").getAttribute("src"),
                 "data:image/png;base64,AAAA");
});

test("reset stays hidden while auto would redraw the plot", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));

    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });

    assert.equal(paneButtons(page).reset.hidden, true);
});

test("a redrawn pane sent again asks for its drawing again", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });

    page.channel.deliver(pane([plot()]));

    assert.equal(renderRequests(page).length, 2);
});

test("a refused plot keeps its drawing and offers only a reset", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()]));
    page.channel.deliver({ type: "rendered", figure: FIGURE, png: "BBBB", slow: false });

    page.channel.deliver({ type: "render_failed", figure: FIGURE, error: "unknown figure" });

    assert.equal(page.outputs().querySelector("img").getAttribute("src"),
                 "data:image/png;base64,BBBB");
    const { auto, redraw, reset } = paneButtons(page);
    assert.deepEqual([auto.hidden, redraw.hidden, reset.hidden], [true, true, false]);
});

test("the auto choice is stored and comes back with the window", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()], { id: "cell-a" }));

    paneButtons(page).auto.click();
    assert.deepEqual(page.storedAutoPanes(), ["cell-a"]);

    const reopened = loadDashboardPage({ channelName: CHANNEL, autoPanes: ["cell-a"] });
    t.after(reopened.close);
    withLayout(reopened);
    reopened.channel.deliver(pane([plot()], { id: "cell-a" }));
    assert.equal(renderRequests(reopened).length, 1);
    assert.equal(paneButtons(reopened).auto.getAttribute("aria-pressed"), "true");
});

test("closing a pane forgets its auto choice", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: ["cell-a"] });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver(pane([plot()], { id: "cell-a" }));

    page.document.querySelector(".pane_button[title^='close']").click();

    assert.deepEqual(page.storedAutoPanes(), []);
});

function versionControls(page) {
    const controls = page.document.querySelector(".pane_versions");
    return {
        controls: controls,
        label: controls.querySelector(".pane_version").textContent,
        older: controls.querySelector(".pane_older"),
        newer: controls.querySelector(".pane_newer"),
    };
}

for (const [version, versions] of [[0, 0], [1, 1]]) {
    test(`a cell at version ${version} of ${versions} shows gray version controls at 1/1`, (t) => {
        const page = loadDashboardPage({ channelName: CHANNEL });
        t.after(page.close);

        page.channel.deliver({ ...pane([]), version: version, versions: versions });

        const { controls, label, older, newer } = versionControls(page);
        assert.equal(controls.classList.contains("pane_single"), true);
        assert.equal(label, "1/1");
        assert.equal(older.disabled, true);
        assert.equal(newer.disabled, true);
    });
}

test("a second run makes the version controls usable", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver({ ...pane([]), version: 1, versions: 1 });

    page.channel.deliver({ ...pane([]), version: 2, versions: 2 });

    const { controls, label, older, newer } = versionControls(page);
    assert.equal(controls.classList.contains("pane_single"), false);
    assert.equal(label, "2/2");
    assert.equal(older.disabled, false);
    assert.equal(newer.disabled, true);
});

test("stepping back and forth asks the notebook for the neighboring versions", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    page.channel.deliver({ ...pane([]), version: 2, versions: 3 });
    page.channel.posted.length = 0;

    versionControls(page).older.click();
    versionControls(page).newer.click();

    assert.deepEqual(page.channel.posted, [
        { type: "version", id: "cell-a", version: 1 },
        { type: "version", id: "cell-a", version: 3 },
    ]);
});

test("an earlier version shows its plot as drawn and asks for no redraw", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);

    page.channel.deliver({ ...pane([plot()]), version: 1, versions: 2 });

    assert.equal(versionControls(page).controls.classList.contains("pane_past"), true);
    assert.equal(page.outputs().querySelector("img").getAttribute("src"),
                 "data:image/png;base64,AAAA");
    assert.deepEqual(renderRequests(page), []);
});

test("stepping back to the latest version lets its plot be drawn again", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL, autoPanes: AUTO });
    t.after(page.close);
    withLayout(page);
    page.channel.deliver({ ...pane([plot()]), version: 1, versions: 2 });

    page.channel.deliver({ ...pane([plot()]), version: 2, versions: 2 });

    assert.equal(versionControls(page).controls.classList.contains("pane_past"), false);
    assert.equal(page.outputs().querySelector("img").dataset.figure, FIGURE);
    assert.deepEqual(renderRequests(page),
                     [{ type: "render", figure: FIGURE, width: 800, height: 600 }]);
});

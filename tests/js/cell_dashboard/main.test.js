"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadCellDashboard } = require("../harness");

const STREAM = { output_type: "stream", name: "stdout", text: "one\n" };

test("the channel and the dashboard's address come from the notebook's path", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);

    dashboard.run("open-dashboard");

    assert.equal(dashboard.channel.name, "cell_dashboard:work/fit.ipynb");
    assert.equal(dashboard.opened.length, 1);
    assert.equal(dashboard.opened[0].name, "cell_dashboard:work/fit.ipynb");
    assert.equal(dashboard.opened[0].features, "popup");
    const opened = dashboard.openWindow("cell_dashboard:work/fit.ipynb");
    const address = new URL(opened.location.href, "http://localhost");
    assert.equal(address.pathname, "/nbextensions/cell_dashboard/dashboard.html");
    assert.equal(address.searchParams.get("channel"), "cell_dashboard:work/fit.ipynb");
});

test("opening again brings the window forward without reloading it", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);
    dashboard.run("open-dashboard");
    const opened = dashboard.openWindow("cell_dashboard:work/fit.ipynb");
    const address = opened.location.href;
    opened.location = { href: address };
    const location = opened.location;

    dashboard.run("open-dashboard");

    assert.equal(opened.location, location);
    assert.equal(opened.location.href, address);
    assert.equal(opened.focused, 2);
});

test("opening again brings back a window that left the dashboard", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);
    dashboard.run("open-dashboard");
    const opened = dashboard.openWindow("cell_dashboard:work/fit.ipynb");
    const address = opened.location.href;
    opened.location = { href: "http://localhost:8888/tree" };

    dashboard.run("open-dashboard");

    assert.equal(opened.location.href, address);
});

test("sending gets the only toolbar button and the t keys", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);

    assert.deepEqual([...dashboard.toolbarButtons], ["cell_dashboard:send-cell-to-dashboard"]);
    assert.deepEqual([...dashboard.commandShortcuts], [
        ["t", "cell_dashboard:send-cell-to-dashboard"],
        ["shift-t", "cell_dashboard:stack-cell-in-dashboard"],
        ["alt-t", "cell_dashboard:send-cell-to-dashboard-and-run"],
        ["alt-shift-t", "cell_dashboard:stack-cell-in-dashboard-and-run"],
    ]);
});

test("the first send opens the dashboard and later sends leave it alone", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");

    assert.equal(dashboard.opened.length, 1);
    assert.equal(dashboard.openWindow("cell_dashboard:work/fit.ipynb").focused, 1);
});

test("a send after the dashboard was closed opens it again", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.openWindow("cell_dashboard:work/fit.ipynb").closed = true;

    dashboard.run("send-cell-to-dashboard");

    assert.equal(dashboard.opened.length, 2);
});

test("a stacked send asks for the bottom edge, and a plain send names none", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("stack-cell-in-dashboard");

    assert.deepEqual(dashboard.channel.posted.map(({ edge }) => edge), [null, "bottom"]);
});

test("sending a markdown cell opens no dashboard", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ cellType: "markdown", source: "# Title" }] });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");

    assert.equal(dashboard.opened.length, 0);
});

test("sending a code cell posts its first line, outputs, and trust", (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "print('one')\nprint('two')", outputs: [STREAM], trusted: false }],
    });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");

    assert.deepEqual(dashboard.channel.posted, [{
        type: "pane",
        id: "cell-0",
        index: 0,
        title: "print('one')",
        outputs: [STREAM],
        trusted: false,
        version: 0,
        versions: 0,
        edge: null,
    }]);
});

for (const [name, source, title] of [
    ["blank lines", "\n\nprint('one')", "print('one')"],
    ["a line of spaces", "   \nfit()", "fit()"],
    ["a comment", "# fit the model\nfit()", "# fit the model"],
    ["nothing", "", ""],
]) {
    test(`a cell starting with ${name} gets the first line with text as its title`, (t) => {
        const dashboard = loadCellDashboard({ cells: [{ source: source }] });
        t.after(dashboard.close);

        dashboard.run("send-cell-to-dashboard");

        assert.equal(dashboard.channel.posted[0].title, title);
    });
}

test("sending a markdown cell posts nothing and keeps the linked cell", (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "a = 1" }, { cellType: "markdown", source: "# Title" }],
    });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);

    dashboard.run("send-cell-to-dashboard");
    dashboard.finishRunning(0);

    assert.deepEqual(dashboard.channel.posted.map(({ title }) => title), ["a = 1", "a = 1"]);
});

test("only the linked cell finishing sends a refresh", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");

    dashboard.finishRunning(1);
    assert.equal(dashboard.channel.posted.length, 1);

    dashboard.finishRunning(0);
    assert.equal(dashboard.channel.posted.length, 2);
});

test("a dashboard that announces itself gets every linked cell", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "ready" });

    assert.deepEqual(dashboard.channel.posted.map(({ title }) => title), ["a = 1", "b = 2"]);
});

test("every linked cell refreshes when it finishes", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.channel.posted.length = 0;

    dashboard.finishRunning(0);
    dashboard.finishRunning(1);

    assert.deepEqual(dashboard.channel.posted.map(({ id }) => id), ["cell-0", "cell-1"]);
});

test("an unlinked cell stops refreshing and stays out of a new dashboard", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "unlink", id: "cell-0" });
    dashboard.finishRunning(0);
    dashboard.channel.deliver({ type: "ready" });

    assert.deepEqual(dashboard.channel.posted.map(({ id }) => id), ["cell-1"]);
});

test("a change to the cell list sends the indices of linked cells", async (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.deleteCell(0);
    dashboard.channel.posted.length = 0;

    await dashboard.changeCellList();

    assert.deepEqual(dashboard.channel.posted, [{ type: "indices", indices: [["cell-1", 0]] }]);
});

test("the notebook announces itself when it loads", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);

    assert.deepEqual(dashboard.announced, [{ type: "hello" }]);
});

test("a notebook still reading its file announces itself once its cells are there", (t) => {
    const dashboard = loadCellDashboard({ cells: [], notebookLoaded: false });
    t.after(dashboard.close);
    assert.deepEqual(dashboard.announced, []);

    dashboard.finishNotebookLoad();

    assert.deepEqual(dashboard.channel.posted, [{ type: "hello" }]);
});

test("a dashboard's panes are linked again, and a pane whose cell is gone gets no index", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);

    dashboard.channel.deliver({ type: "panes", ids: ["cell-1", "cell-9"] });
    dashboard.finishRunning(1);

    assert.deepEqual(dashboard.channel.posted.map(({ type, id }) => [type, id]), [
        ["pane", "cell-1"],
        ["indices", undefined],
        ["pane", "cell-1"],
    ]);
    assert.deepEqual(dashboard.channel.posted[1].indices, [["cell-1", 1], ["cell-9", null]]);
    assert.deepEqual(dashboard.linkedMarks(), [false, true]);
});

test("a linked cell carries a marker until it is unlinked", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");
    assert.deepEqual(dashboard.linkedMarks(), [true, false]);

    dashboard.channel.deliver({ type: "unlink", id: "cell-0" });
    assert.deepEqual(dashboard.linkedMarks(), [false, false]);
});

test("a cell rebuilt by an undone delete gets its marker back", async (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.rebuildCell(0, "a = 1");

    await dashboard.changeCellList();

    assert.deepEqual(dashboard.linkedMarks(), [true]);
});

test("a jump selects the linked cell and scrolls to it", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(0);

    dashboard.channel.deliver({ type: "jump", id: "cell-1" });

    assert.equal(dashboard.selectedIndex(), 1);
    assert.deepEqual([...dashboard.scrolledTo], [1]);
});

test("a cell rebuilt with its id, as an undone delete is, stays linked", async (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(0);
    dashboard.rebuildCell(1, "b = 3");
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "ready" });
    dashboard.channel.deliver({ type: "jump", id: "cell-1" });
    await dashboard.changeCellList();

    assert.deepEqual(dashboard.channel.posted.map(({ title }) => title), ["b = 3", undefined]);
    assert.deepEqual(dashboard.channel.posted[1], { type: "indices", indices: [["cell-1", 1]] });
    assert.deepEqual([...dashboard.scrolledTo], [1]);
});

test("a jump to a cell deleted from the notebook does nothing", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");
    dashboard.select(0);
    dashboard.deleteCell(1);

    dashboard.channel.deliver({ type: "jump", id: "cell-1" });

    assert.equal(dashboard.selectedIndex(), 0);
    assert.equal(dashboard.scrolledTo.length, 0);
});

test("a jump finds its cell by id even when the notebook holds no link to it", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);

    dashboard.channel.deliver({ type: "jump", id: "cell-1" });

    assert.deepEqual([...dashboard.scrolledTo], [1]);
});

test("a dashboard that announces itself before any send gets nothing", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }] });
    t.after(dashboard.close);

    dashboard.channel.deliver({ type: "ready" });

    assert.equal(dashboard.channel.posted.length, 0);
});

function runWithOutputs(dashboard, spec, outputs) {
    spec.outputs = outputs;
    dashboard.finishRunning(0);
}

test("each run of a linked cell adds a version, and the latest is shown", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");

    runWithOutputs(dashboard, spec, [STREAM]);
    runWithOutputs(dashboard, spec, [{ ...STREAM, text: "two\n" }]);

    assert.deepEqual(dashboard.channel.posted.map(({ version, versions }) => [version, versions]),
                     [[0, 0], [1, 1], [2, 2]]);
    assert.equal(dashboard.channel.posted[2].outputs[0].text, "two\n");
});

test("asking for a version sends the outputs of that run", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    runWithOutputs(dashboard, spec, [{ ...STREAM, text: "two\n" }]);
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "version", id: "cell-0", version: 1 });
    dashboard.channel.deliver({ type: "version", id: "cell-0", version: 3 });

    assert.equal(dashboard.channel.posted.length, 1);
    assert.deepEqual(dashboard.channel.posted[0].outputs, [STREAM]);
    assert.equal(dashboard.channel.posted[0].version, 1);
    assert.equal(dashboard.channel.posted[0].versions, 2);
});

test("unlinking a cell drops its history", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    runWithOutputs(dashboard, spec, [STREAM]);

    dashboard.channel.deliver({ type: "unlink", id: "cell-0" });
    dashboard.channel.posted.length = 0;
    dashboard.channel.deliver({ type: "version", id: "cell-0", version: 1 });
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);

    assert.deepEqual(dashboard.channel.posted.map(({ version, versions }) => [version, versions]),
                     [[0, 0], [1, 1]]);
});

test("an aborted run adds no version, whether its reply comes before idle or after", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    dashboard.channel.posted.length = 0;

    spec.outputs = [];
    dashboard.finishRunning(0, { status: "aborted" });
    dashboard.finishRunning(0, { status: "aborted", replyFirst: false });
    assert.deepEqual(dashboard.channel.posted, []);

    runWithOutputs(dashboard, spec, [STREAM]);
    assert.deepEqual(dashboard.channel.posted.map(({ versions }) => versions), [2]);
});

test("an earlier version shows the first line of the source that ran", (t) => {
    const spec = { source: "print(1)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    spec.source = "print(2)";
    runWithOutputs(dashboard, spec, [STREAM]);
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "version", id: "cell-0", version: 1 });

    assert.equal(dashboard.channel.posted[0].title, "print(1)");
});

test("a reopened dashboard gets the latest version with the full count", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    runWithOutputs(dashboard, spec, [STREAM]);
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "ready" });

    assert.deepEqual(dashboard.channel.posted.map(({ version, versions }) => [version, versions]),
                     [[2, 2]]);
});

test("asking for a version of a cell deleted from the notebook sends nothing", (t) => {
    const spec = { source: "print(x)" };
    const dashboard = loadCellDashboard({ cells: [spec] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    runWithOutputs(dashboard, spec, [STREAM]);
    runWithOutputs(dashboard, spec, [STREAM]);
    dashboard.deleteCell(0);
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "version", id: "cell-0", version: 1 });

    assert.deepEqual(dashboard.channel.posted, []);
});

for (const replyFirst of [true, false]) {
    test(`a rerun mid-run adds one version, reply ${replyFirst ? "before" : "after"} idle`, (t) => {
        const spec = { source: "print(x)" };
        const dashboard = loadCellDashboard({ cells: [spec] });
        t.after(dashboard.close);
        dashboard.run("send-cell-to-dashboard");
        spec.outputs = [STREAM];

        dashboard.finishRunning(0, { replyFirst: replyFirst, idles: 3 });

        assert.deepEqual(dashboard.channel.posted.map(({ versions }) => versions), [0, 1]);
    });
}

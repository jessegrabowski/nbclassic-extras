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
    const address = new URL(dashboard.opened[0].url, "http://localhost");
    assert.equal(address.pathname, "/nbextensions/cell_dashboard/dashboard.html");
    assert.equal(address.searchParams.get("channel"), "cell_dashboard:work/fit.ipynb");
});

test("both actions get toolbar buttons", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);

    assert.deepEqual([...dashboard.toolbarButtons], [
        "cell_dashboard:open-dashboard",
        "cell_dashboard:send-cell-to-dashboard",
    ]);
});

test("sending a code cell posts its first line, outputs, and trust", (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "print('one')\nprint('two')", outputs: [STREAM], trusted: false }],
    });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");

    assert.deepEqual(dashboard.channel.posted, [{
        type: "pane",
        title: "print('one')",
        outputs: [STREAM],
        trusted: false,
    }]);
});

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

test("a dashboard that announces itself gets the linked cell", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }] });
    t.after(dashboard.close);
    dashboard.run("send-cell-to-dashboard");
    dashboard.channel.posted.length = 0;

    dashboard.channel.deliver({ type: "ready" });

    assert.deepEqual(dashboard.channel.posted.map(({ title }) => title), ["a = 1"]);
});

test("a dashboard that announces itself before any send gets nothing", (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }] });
    t.after(dashboard.close);

    dashboard.channel.deliver({ type: "ready" });

    assert.equal(dashboard.channel.posted.length, 0);
});

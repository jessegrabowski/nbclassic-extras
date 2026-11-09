"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadCellDashboard } = require("../harness");

const FIGURE = "0123456789abcdef0123456789abcdef";

function expressions(request) {
    return request.options.user_expressions;
}

// answers the install request sent when the extension starts, and links the first cell
async function linkedDashboard(t, { cells = [{ source: "plot()" }], installed = true } = {}) {
    const dashboard = loadCellDashboard({ cells: cells });
    t.after(dashboard.close);
    await dashboard.settle();
    dashboard.answer(0, { install: { installed: installed } });
    dashboard.run("send-cell-to-dashboard");
    await dashboard.settle();
    dashboard.channel.posted.length = 0;
    return dashboard;
}

function renderRequest(width = 800, height = 600) {
    return { type: "render", figure: FIGURE, width: width, height: height };
}

test("a Python kernel gets the helper once and silently, before anything is sent", async (t) => {
    const dashboard = loadCellDashboard({ cells: [{ source: "a = 1" }, { source: "b = 2" }] });
    t.after(dashboard.close);
    assert.equal(dashboard.kernelRequests.length, 1);

    dashboard.run("send-cell-to-dashboard");
    dashboard.select(1);
    dashboard.run("send-cell-to-dashboard");

    assert.equal(dashboard.kernelRequests.length, 1);
    const [load] = dashboard.kernelRequests;
    assert.match(load.code, /^exec\(/);
    assert.equal(load.options.silent, true);
    assert.equal(load.options.store_history, false);
    assert.match(expressions(load).install, /\.install\(\)$/);
});

test("a kernel that is not Python gets no helper", async (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "x <- 1" }],
        kernelLanguage: "R",
        kernelspecLanguage: "R",
    });
    t.after(dashboard.close);
    await dashboard.settle();

    dashboard.run("send-cell-to-dashboard");
    dashboard.runCell(0);

    assert.equal(dashboard.kernelRequests.length, 0);
});

test("a linked cell is armed just before it runs", async (t) => {
    const dashboard = await linkedDashboard(t);

    dashboard.runCell(0);

    const arm = dashboard.kernelRequests.at(-1);
    assert.match(expressions(arm).armed, /\.arm\("cell-0"\)$/);
    assert.match(arm.code, /^exec\(/);
    assert.equal(arm.options.silent, true);
    assert.deepEqual([...dashboard.ran], ["cell-0"]);
});

test("a linked cell tagged dashboard-no-redraw runs unarmed", async (t) => {
    const dashboard = await linkedDashboard(t, {
        cells: [{ source: "plot()", tags: ["slow", "dashboard-no-redraw"] }],
    });
    const before = dashboard.kernelRequests.length;

    dashboard.runCell(0);

    assert.equal(dashboard.kernelRequests.length, before);
    assert.deepEqual([...dashboard.ran], ["cell-0"]);
});

test("an unlinked cell and an empty linked cell run unarmed", async (t) => {
    const dashboard = await linkedDashboard(t, {
        cells: [{ source: "  " }, { source: "b = 2" }],
    });
    const before = dashboard.kernelRequests.length;

    dashboard.runCell(0);
    dashboard.runCell(1);

    assert.equal(dashboard.kernelRequests.length, before);
});

test("a render request asks the kernel and passes its drawing on", async (t) => {
    const dashboard = await linkedDashboard(t);

    dashboard.channel.deliver(renderRequest(800, 600));
    await dashboard.settle();
    const render = dashboard.kernelRequests.at(-1);
    dashboard.answer(dashboard.kernelRequests.length - 1, {
        render: { png: "AAAA", width: 800, height: 600, seconds: 0.05 },
    });
    await dashboard.settle();

    assert.match(expressions(render).render, new RegExp(`\\.render\\("${FIGURE}", 800, 600\\)$`));
    assert.deepEqual(dashboard.channel.posted,
                     [{ type: "rendered", figure: FIGURE, png: "AAAA", slow: false }]);
});

test("a slow render is passed on marked slow", async (t) => {
    const dashboard = await linkedDashboard(t);

    dashboard.channel.deliver(renderRequest());
    await dashboard.settle();
    dashboard.answer(dashboard.kernelRequests.length - 1, {
        render: { png: "AAAA", width: 800, height: 600, seconds: 1.5 },
    });
    await dashboard.settle();

    assert.equal(dashboard.channel.posted[0].slow, true);
});

test("a refused render is passed on as a failure with the kernel's reason", async (t) => {
    const dashboard = await linkedDashboard(t);

    dashboard.channel.deliver(renderRequest());
    await dashboard.settle();
    dashboard.answer(dashboard.kernelRequests.length - 1, {
        render: { error: "changed since it was shown" },
    });
    await dashboard.settle();

    assert.deepEqual(dashboard.channel.posted, [{
        type: "render_failed",
        figure: FIGURE,
        error: "changed since it was shown",
    }]);
});

test("a helper that could not install answers every render with a failure", async (t) => {
    const dashboard = await linkedDashboard(t, { installed: false });
    const before = dashboard.kernelRequests.length;

    dashboard.channel.deliver(renderRequest());
    await dashboard.settle();

    assert.equal(dashboard.kernelRequests.length, before);
    assert.equal(dashboard.channel.posted[0].type, "render_failed");
});

for (const [name, message] of [
    ["a figure id that is not hex", { ...renderRequest(), figure: "x'); import os; ('" }],
    ["a fractional width", renderRequest(800.5, 600)],
    ["a zero height", renderRequest(800, 0)],
    ["a side past the limit", renderRequest(5000, 600)],
    ["a width given as text", { ...renderRequest(), width: "800" }],
]) {
    test(`a render request with ${name} is ignored`, async (t) => {
        const dashboard = await linkedDashboard(t);
        const before = dashboard.kernelRequests.length;

        dashboard.channel.deliver(message);
        await dashboard.settle();

        assert.equal(dashboard.kernelRequests.length, before);
    });
}

test("renders wait for a busy kernel to go idle", async (t) => {
    const dashboard = await linkedDashboard(t);
    const before = dashboard.kernelRequests.length;
    dashboard.setKernelBusy(true);

    dashboard.channel.deliver(renderRequest());
    await dashboard.settle();
    assert.equal(dashboard.kernelRequests.length, before);

    dashboard.setKernelBusy(false);
    await dashboard.settle();
    assert.equal(dashboard.kernelRequests.length, before + 1);
});

test("one render runs at a time, and a waiting figure is drawn at its latest size", async (t) => {
    const dashboard = await linkedDashboard(t);
    const before = dashboard.kernelRequests.length;
    dashboard.channel.deliver(renderRequest(800, 600));
    await dashboard.settle();

    dashboard.channel.deliver(renderRequest(400, 300));
    dashboard.channel.deliver(renderRequest(600, 450));
    await dashboard.settle();
    assert.equal(dashboard.kernelRequests.length, before + 1);

    dashboard.answer(before, { render: { png: "AAAA", width: 800, height: 600, seconds: 0.1 } });
    await dashboard.settle();
    assert.equal(dashboard.kernelRequests.length, before + 2);
    assert.match(expressions(dashboard.kernelRequests.at(-1)).render, /, 600, 450\)$/);
});

test("a send loads the helper into a kernel that became Python after it arrived", async (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "plot()" }],
        kernelLanguage: "",
        kernelspecLanguage: "",
    });
    t.after(dashboard.close);
    await dashboard.settle();
    assert.equal(dashboard.kernelRequests.length, 0);
    dashboard.becomePython();

    dashboard.run("send-cell-to-dashboard");
    dashboard.runCell(0);

    assert.match(expressions(dashboard.kernelRequests[0]).install, /\.install\(\)$/);
    assert.match(expressions(dashboard.kernelRequests[1]).armed, /\.arm\("cell-0"\)$/);
});

test("a kernel that has not answered yet counts as its kernelspec's language", async (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "plot()" }],
        kernelLanguage: undefined,
    });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");
    dashboard.runCell(0);

    assert.match(expressions(dashboard.kernelRequests[0]).install, /\.install\(\)$/);
    assert.match(expressions(dashboard.kernelRequests.at(-1)).armed, /\.arm\("cell-0"\)$/);
});

test("a kernel's own answer outranks its kernelspec", async (t) => {
    const dashboard = loadCellDashboard({
        cells: [{ source: "plot()" }],
        kernelLanguage: "R",
        kernelspecLanguage: "python",
    });
    t.after(dashboard.close);

    dashboard.run("send-cell-to-dashboard");
    dashboard.runCell(0);

    assert.equal(dashboard.kernelRequests.length, 0);
});

test("a restarted kernel gets the helper again", async (t) => {
    const dashboard = await linkedDashboard(t);
    const before = dashboard.kernelRequests.length;

    dashboard.restartKernel();

    assert.equal(dashboard.kernelRequests.length, before + 1);
    assert.match(expressions(dashboard.kernelRequests.at(-1)).install, /\.install\(\)$/);
});

test("a render cut off by a restart lets the next one through", async (t) => {
    const dashboard = await linkedDashboard(t);
    dashboard.channel.deliver(renderRequest(800, 600));
    await dashboard.settle();

    dashboard.restartKernel();
    dashboard.answer(dashboard.kernelRequests.length - 1, { install: { installed: true } });
    await dashboard.settle();
    dashboard.channel.deliver(renderRequest(400, 300));
    await dashboard.settle();

    assert.match(expressions(dashboard.kernelRequests.at(-1)).render, /, 400, 300\)$/);
});

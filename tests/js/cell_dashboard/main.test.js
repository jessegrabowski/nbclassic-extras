"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadCellDashboard } = require("../harness");

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

test("opening the dashboard gets a toolbar button", (t) => {
    const dashboard = loadCellDashboard({ cells: [] });
    t.after(dashboard.close);

    assert.deepEqual([...dashboard.toolbarButtons], ["cell_dashboard:open-dashboard"]);
});

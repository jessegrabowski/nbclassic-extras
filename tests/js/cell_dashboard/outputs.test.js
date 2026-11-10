"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadDashboardOutputs } = require("../harness");

test("an interactive renderer's output and everything inside it count as interactive", (t) => {
    const outputs = loadDashboardOutputs();
    t.after(outputs.close);
    const render = (label) => {
        const plot = outputs.document.createElement("div");
        plot.append(outputs.document.createElement("span"));
        plot.dataset.label = label;
        return plot;
    };

    const plot = outputs.interactive(render)("zoomable");

    assert.equal(plot.dataset.label, "zoomable");
    assert.equal(outputs.isInInteractiveOutput(plot), true);
    assert.equal(outputs.isInInteractiveOutput(plot.querySelector("span")), true);
    assert.equal(outputs.isInInteractiveOutput(render("static")), false);
});

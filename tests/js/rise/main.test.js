"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cell, loadRise } = require("../harness");

test("entering wraps cells in slide sections and exiting puts them back", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");
    assert.equal($("#notebook-container > section > section#slide-0-0").text(), "Alpha");

    rise.run("RISE:slideshow");
    assert.equal($("#notebook-container section").length, 0);
    assert.equal($("#notebook-container > .cell").text(), "Alpha");
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cell, loadRise } = require("../harness");

// Texts of the cells directly inside `selector`, in DOM order. Built as a Node array because
// deepEqual rejects arrays created in the jsdom realm even when their contents match.
function cellTexts($, selector) {
    return Array.from($(selector).children(".cell"), (element) => element.textContent);
}

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

test("a leading slide cell does not create an empty first slide", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide"), cell("Bravo", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.equal($("#notebook-container > section").length, 2);
    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-1-0"), ["Bravo"]);
});

test("a leading subslide cell stays on the first subslide", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "subslide"), cell("Bravo", "subslide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-1"), ["Bravo"]);
});

test("a leading fragment cell is shown with the first slide, not as a fragment", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "fragment"), cell("Bravo", "fragment")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-0 > div.fragment"), ["Bravo"]);
});

test("leading notes and skip cells do not count as first-slide content", async (t) => {
    const cells = [cell("Spoken", "notes"), cell("Skipped", "skip"), cell("Alpha", "slide")];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.equal($("#notebook-container > section").length, 1);
    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Skipped", "Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-0 > aside.notes"), ["Spoken"]);
});

test("a fragment groups the regular cells that follow it", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "fragment"),
        cell("Charlie", ""),
        cell("Delta", "fragment"),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    const fragments = $("#slide-0-0 > div.fragment");
    assert.equal(fragments.length, 2);
    assert.deepEqual(cellTexts($, fragments.eq(0)), ["Bravo", "Charlie"]);
    assert.deepEqual(cellTexts($, fragments.eq(1)), ["Delta"]);
});

test("a notes cell after a fragment goes under the subslide, outside the fragment", async (t) => {
    const cells = [cell("Alpha", "slide"), cell("Bravo", "fragment"), cell("Spoken", "notes")];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0 > aside.notes"), ["Spoken"]);
    assert.equal($("div.fragment aside.notes").length, 0);
});

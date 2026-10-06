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

test("a notes cell after a fragment goes inside that fragment", async (t) => {
    const cells = [cell("Alpha", "slide"), cell("Bravo", "fragment"), cell("Spoken", "notes")];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0 > div.fragment > aside.notes"), ["Spoken"]);
});

test("dash and unset slide types are regular cells", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "-"),
        cell("Charlie", "slide"),
        cell("Delta", undefined),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha", "Bravo"]);
    assert.deepEqual(cellTexts($, "#slide-1-0"), ["Charlie", "Delta"]);
    const tags = rise.cells.map((c) => c.smart_exec);
    assert.deepEqual(tags, [
        "smart_exec_next",
        "smart_exec_slide",
        "smart_exec_next",
        "smart_exec_slide",
    ]);
});

test("smart-exec tags look past notes and skip cells to the next visible cell", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", ""),
        cell("Spoken", "notes"),
        cell("Charlie", "fragment"),
        cell("Skipped", "skip"),
        cell("Delta", "slide"),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    const tags = rise.cells.map((c) => c.smart_exec);
    assert.deepEqual(tags, [
        "smart_exec_next",
        "smart_exec_fragment",
        "smart_exec_fragment",
        "smart_exec_slide",
        "smart_exec_slide",
        "smart_exec_slide",
    ]);
    assert.equal(rise.cells[1].smart_exec_next_fragment[0], $("div.fragment")[0]);
});

test("exiting keeps notebook order when a notes cell follows a fragment", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "fragment"),
        cell("Spoken", "notes"),
        cell("Charlie", ""),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#notebook-container"), ["Alpha", "Bravo", "Spoken", "Charlie"]);
});

test("auto-select finds the code cell when the notebook starts with a subslide", async (t) => {
    const cells = [cell("Alpha", "subslide"), cell("x = 1", "", "code")];
    const metadata = { rise: { auto_select_timeout: 0 } };
    const rise = await loadRise({ cells: cells, metadata: metadata });
    t.after(rise.close);

    rise.run("RISE:slideshow");
    await rise.idle(20);

    assert.deepEqual(rise.cells.map((c) => c.selected), [false, true]);
});

test("auto-select finds the code cell when the notebook starts with a fragment", async (t) => {
    const cells = [cell("Alpha", "fragment"), cell("x = 1", "", "code")];
    const metadata = { rise: { auto_select_timeout: 0 } };
    const rise = await loadRise({ cells: cells, metadata: metadata });
    t.after(rise.close);

    rise.run("RISE:slideshow");
    await rise.idle(20);

    assert.deepEqual(rise.cells.map((c) => c.selected), [false, true]);
});

// Config layers from lowest to highest precedence, each with the theme it sets.
const CONFIG_LAYERS = [
    ["nbconfig livereveal", "beige", (config, theme) => (config.sections.livereveal = { theme })],
    ["nbconfig rise", "blood", (config, theme) => (config.sections.rise = { theme })],
    ["notebook config rise", "league", (config, theme) => (config.notebookConfig.rise = { theme })],
    ["metadata livereveal", "moon", (config, theme) => (config.metadata.livereveal = { theme })],
    ["metadata rise", "night", (config, theme) => (config.metadata.rise = { theme })],
];

test("without any config the slideshow uses the simple theme", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.ok($("body").hasClass("theme-simple"));
    assert.match($("link#theme").attr("href"), /reveal\.js\/css\/theme\/simple\.css$/);
});

CONFIG_LAYERS.forEach(([layerName, layerTheme], top) => {
    test(`${layerName} takes precedence over the defaults and every lower layer`, async (t) => {
        const config = { sections: {}, notebookConfig: {}, metadata: {} };
        CONFIG_LAYERS.slice(0, top + 1).forEach(([, theme, apply]) => apply(config, theme));
        const rise = await loadRise({ cells: [cell("Alpha", "slide")], ...config });
        t.after(rise.close);
        const { $ } = rise;

        rise.run("RISE:slideshow");

        const bodyClasses = $("body").attr("class").split(/\s+/);
        const themes = bodyClasses.filter((name) => name.startsWith("theme-"));
        assert.deepEqual(themes, [`theme-${layerTheme}`]);
    });
});

test("nested settings from different config layers merge", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        sections: { rise: { shortcuts: { slideshow: "alt-q" } } },
        metadata: { rise: { shortcuts: { "toggle-slide": "shift-x" } } },
    });
    t.after(rise.close);

    const bindings = rise.shortcuts.command.bindings;
    assert.equal(bindings.get("alt-q"), "RISE:slideshow");
    assert.equal(bindings.get("shift-x"), "RISE:toggle-slide");
    assert.equal(bindings.get("shift-b"), "RISE:toggle-subslide");
});

test("metadata config applies when the notebook finishes loading after RISE", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { theme: "night" } },
        notebookLoaded: false,
    });
    t.after(rise.close);
    const { $ } = rise;

    rise.finishNotebookLoad();
    await rise.idle(0);
    rise.run("RISE:slideshow");

    assert.ok($("body").hasClass("theme-night"));
});

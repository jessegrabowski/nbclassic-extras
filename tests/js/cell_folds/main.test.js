"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadCellFolds } = require("../harness");

const CODE = { cellType: "code", executionCount: null };
const SELECTED = { ...CODE, selected: true };
const MARKDOWN = { cellType: "markdown", selected: true };

test("every target has fold and unfold actions on selected cells and on all cells", (t) => {
    const folds = loadCellFolds({ cells: [CODE] });
    t.after(folds.close);
    const expected = ["fold", "unfold"].flatMap((direction) =>
        ["input", "output", "joint"].flatMap((target) =>
            ["selected", "all"].map((scope) => `cell_folds:${direction}-${target}-of-${scope}`)))
        .concat("cell_folds:fold-block", "cell_folds:unfold-block");

    assert.deepEqual([...folds.actions.keys()].sort(), expected.sort());
    assert.equal(folds.actions.get("cell_folds:fold-joint-of-all").help,
                 "fold input and output of all cells");
});

test("loading the extension adds its stylesheet", (t) => {
    const folds = loadCellFolds({ cells: [CODE] });
    t.after(folds.close);

    assert.equal(folds.$("link[href='./main.css']").length, 1);
});

test("an input fold marks only selected code cells and leaves the notebook clean", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED, CODE, MARKDOWN] });
    t.after(folds.close);

    folds.run("fold-input-of-selected");

    assert.deepEqual(folds.inputFolded(), [true, false, false]);
    assert.deepEqual(folds.outputCollapsed(), [false, false, false]);
    assert.equal(folds.notebook.dirty, false);
});

test("an unfold refreshes only the editors that were hidden", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED, CODE] });
    t.after(folds.close);
    const [folded, visible] = folds.notebook.get_cells();

    folds.run("fold-input-of-selected");
    folds.run("unfold-input-of-all");

    assert.deepEqual(folds.inputFolded(), [false, false]);
    assert.equal(folded.refreshes, 1);
    assert.equal(visible.refreshes, 0);
});

test("an output fold uses nbclassic's collapse and marks the notebook dirty", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED, CODE] });
    t.after(folds.close);

    folds.run("fold-output-of-selected");

    assert.deepEqual(folds.outputCollapsed(), [true, false]);
    assert.deepEqual(folds.inputFolded(), [false, false]);
    assert.equal(folds.notebook.dirty, true);

    folds.run("unfold-output-of-selected");
    assert.deepEqual(folds.outputCollapsed(), [false, false]);
});

test("a joint fold folds input and output together", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED, CODE] });
    t.after(folds.close);

    folds.run("fold-joint-of-selected");
    assert.deepEqual(folds.inputFolded(), [true, false]);
    assert.deepEqual(folds.outputCollapsed(), [true, false]);

    folds.run("unfold-joint-of-selected");
    assert.deepEqual(folds.inputFolded(), [false, false]);
    assert.deepEqual(folds.outputCollapsed(), [false, false]);
});

test("folding every code cell's input enters the reading view, ignoring text cells", (t) => {
    const folds = loadCellFolds({ cells: [MARKDOWN, CODE, CODE] });
    t.after(folds.close);

    folds.run("fold-input-of-all");
    assert.deepEqual(folds.inputFolded(), [false, true, true]);
    assert.equal(folds.readingView(), true);

    folds.run("unfold-input-of-all");
    assert.equal(folds.readingView(), false);
});

test("folding some inputs stays out of the reading view", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED, CODE] });
    t.after(folds.close);

    folds.run("fold-input-of-selected");

    assert.equal(folds.readingView(), false);
});

test("a notebook with no code cells never enters the reading view", (t) => {
    const folds = loadCellFolds({ cells: [MARKDOWN] });
    t.after(folds.close);

    folds.run("fold-input-of-selected");

    assert.equal(folds.readingView(), false);
});

test("an output fold with no code cell in scope leaves the notebook clean", (t) => {
    const folds = loadCellFolds({ cells: [MARKDOWN, CODE] });
    t.after(folds.close);

    folds.run("fold-output-of-selected");

    assert.deepEqual(folds.outputCollapsed(), [false, false]);
    assert.equal(folds.notebook.dirty, false);
});

test("an output change that changes nothing leaves the notebook clean", (t) => {
    const folds = loadCellFolds({ cells: [SELECTED] });
    t.after(folds.close);

    folds.run("unfold-output-of-all");

    assert.equal(folds.notebook.dirty, false);
});

test("focusing a folded cell's editor reveals it and leaves the reading view", (t) => {
    const folds = loadCellFolds({ cells: [CODE, CODE] });
    t.after(folds.close);
    const [first] = folds.notebook.get_cells();
    folds.run("fold-input-of-all");

    first.focus_editor();

    assert.deepEqual(folds.inputFolded(), [false, true]);
    assert.equal(folds.readingView(), false);
    assert.equal(first.focused, true);
});

test("the separate key system is the default, with shift acting on all cells", async (t) => {
    const folds = loadCellFolds({ cells: [CODE] });
    t.after(folds.close);
    await folds.loaded;

    assert.equal(new Set(folds.shortcuts.values()).size, 12);
    assert.ok([...folds.shortcuts.values()].every((action) => folds.actions.has(action)));
    assert.equal(folds.shortcuts.get("-"), "cell_folds:fold-input-of-selected");
    assert.equal(folds.shortcuts.get("shift-="), "cell_folds:unfold-input-of-all");
    assert.equal(folds.shortcuts.get("["), "cell_folds:fold-output-of-selected");
    assert.equal(folds.shortcuts.get("'"), "cell_folds:unfold-joint-of-selected");
});

test("the chord key system replaces the separate keys", async (t) => {
    const folds = loadCellFolds({ cells: [CODE],
                                  config: { cell_folds_key_system: "chords" } });
    t.after(folds.close);
    await folds.loaded;

    assert.equal(new Set(folds.shortcuts.values()).size, 12);
    assert.ok([...folds.shortcuts.values()].every((action) => folds.actions.has(action)));
    assert.equal(folds.shortcuts.get("alt--"), "cell_folds:fold-input-of-selected");
    assert.equal(folds.shortcuts.get("shift-alt-["), "cell_folds:fold-output-of-all");
    assert.equal(folds.shortcuts.get("alt-'"), "cell_folds:unfold-joint-of-selected");
    assert.equal(folds.shortcuts.has("-"), false);
});

test("edit mode binds block folds under either key system", async (t) => {
    for (const config of [{}, { cell_folds_key_system: "chords" }]) {
        const folds = loadCellFolds({ cells: [CODE], config: config });
        t.after(folds.close);
        await folds.loaded;

        assert.equal(folds.editShortcuts.size, 2);
        assert.equal(folds.editShortcuts.get("alt--"), "cell_folds:fold-block");
        assert.equal(folds.editShortcuts.get("alt-="), "cell_folds:unfold-block");
        assert.ok([...folds.editShortcuts.values()].every((action) => folds.actions.has(action)));
    }
});

test("an unknown key system warns and falls back to the separate keys", async (t) => {
    const warnings = t.mock.method(console, "warn", () => {});
    const folds = loadCellFolds({ cells: [CODE], config: { cell_folds_key_system: "nope" } });
    t.after(folds.close);
    await folds.loaded;

    assert.equal(folds.shortcuts.get("-"), "cell_folds:fold-input-of-selected");
    assert.equal(warnings.mock.callCount(), 1);
    assert.match(warnings.mock.calls[0].arguments[0], /nope/);
});

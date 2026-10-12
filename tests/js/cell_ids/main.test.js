"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadCellIds } = require("../harness");

const CODE = { cellType: "code", executionCount: null };
const MARKDOWN = { cellType: "markdown" };

test("every cell's prompt shows its index, counting from 0", (t) => {
    const cellIds = loadCellIds({ cells: [MARKDOWN, CODE, CODE] });
    t.after(cellIds.close);

    assert.deepEqual(cellIds.shownIndices(), ["0", "1", "2"]);
    assert.equal(cellIds.$("link[href='./main.css']").length, 1);
});

// main.css restores the padding nbclassic drops from an empty prompt, so the index lines up
test("a markdown cell's prompt stays empty, holding only its index", (t) => {
    const cellIds = loadCellIds({ cells: [CODE, MARKDOWN] });
    t.after(cellIds.close);
    const prompt = cellIds.$(".text_cell .input_prompt");

    assert.equal(prompt.html(), "");
    assert.equal(prompt.attr("data-cell-index"), "1");
});

test("a code cell's execution count moves beneath its index without dirtying the notebook", (t) => {
    const cellIds = loadCellIds({ cells: [{ cellType: "code", executionCount: 3 }] });
    t.after(cellIds.close);
    const { $ } = cellIds;

    assert.equal($(".input_prompt > .cell_run").text(), "In\u00a0[3]:");
    assert.equal(cellIds.notebook.dirty, false);
});

test("running a cell keeps its index and demotes the new execution count", (t) => {
    const cellIds = loadCellIds({ cells: [CODE] });
    t.after(cellIds.close);
    const [codeCell] = cellIds.notebook.get_cells();

    codeCell.set_input_prompt(4);

    assert.equal(cellIds.$(".input_prompt > .cell_run").text(), "In\u00a0[4]:");
    assert.deepEqual(cellIds.shownIndices(), ["0"]);
});

test("inserting, moving, and deleting cells renumbers every prompt", async (t) => {
    const cellIds = loadCellIds({ cells: [MARKDOWN, CODE, CODE] });
    t.after(cellIds.close);
    const [first] = cellIds.notebook.get_cells();

    cellIds.insertCell(CODE, 0);
    await cellIds.settle();
    assert.deepEqual(cellIds.shownIndices(), ["0", "1", "2", "3"]);

    cellIds.moveCell(1, 3);
    await cellIds.settle();
    assert.equal(first.element.find(".input_prompt").attr("data-cell-index"), "3");

    cellIds.deleteCell(0);
    await cellIds.settle();
    assert.deepEqual(cellIds.shownIndices(), ["0", "1", "2"]);
});

test("an output holding notebook markup leaves the cell's own prompt in charge", (t) => {
    const exported = '<div class="prompt input_prompt">In&nbsp;[9]:</div>';
    const exporting = { cellType: "code", executionCount: 2, outputHtml: exported };
    const cellIds = loadCellIds({ cells: [exporting] });
    t.after(cellIds.close);
    const { $ } = cellIds;
    const [ownPrompt, outputPrompt] = $(".input_prompt").toArray().map((prompt) => $(prompt));

    assert.equal(ownPrompt.attr("data-cell-index"), "0");
    assert.equal(ownPrompt.children(".cell_run").text(), "In\u00a0[2]:");
    assert.equal(outputPrompt.attr("data-cell-index"), undefined);
    assert.equal(outputPrompt.children(".cell_run").length, 0);
});

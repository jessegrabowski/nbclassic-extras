/*
 * cell_ids: show each cell's position in the notebook as its prompt, counting from 0, with a code
 * cell's execution count beneath it in smaller, muted type.
 *
 * The position is written to the prompt's data-cell-index attribute, which nbclassic's
 * set_input_prompt leaves alone when it rewrites the prompt's contents.
 */
define([
    'require',
    'jquery',
    'base/js/namespace',
    'notebook/js/codecell',
], function (require, $, Jupyter, codecell) {
    "use strict";

    const CodeCell = codecell.CodeCell;

    function loadStylesheet() {
        $('<link/>')
            .attr({rel: 'stylesheet', type: 'text/css', href: require.toUrl('./main.css')})
            .appendTo('head');
    }

    // an output can show exported notebook markup with input prompts of its own, but the cell's
    // prompt precedes every output, and querySelector stops at it without searching them
    function inputPrompt(cell) {
        return $(cell.element[0].querySelector('div.input_prompt'));
    }

    function numberCells() {
        Jupyter.notebook.get_cells().forEach((cell, index) => {
            inputPrompt(cell).attr('data-cell-index', index);
        });
    }

    function demoteRunCount(cell) {
        inputPrompt(cell).contents().wrapAll($('<div/>').addClass('cell_run'));
    }

    function demoteRunCounts() {
        let setInputPrompt = CodeCell.prototype.set_input_prompt;
        CodeCell.prototype.set_input_prompt = function () {
            setInputPrompt.apply(this, arguments);
            demoteRunCount(this);
        };
        // these prompts were written before the wrapper existed
        Jupyter.notebook.get_cells()
            .filter((cell) => cell instanceof CodeCell)
            .forEach(demoteRunCount);
    }

    // inserts, deletes, and moves, whether from the notebook UI or another extension, all add or
    // remove children of the notebook container
    function renumberOnChange() {
        new MutationObserver(numberCells).observe(Jupyter.notebook.container[0], {childList: true});
        numberCells();
    }

    function load_jupyter_extension() {
        loadStylesheet();
        demoteRunCounts();
        renumberOnChange();
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

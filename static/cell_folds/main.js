/*
 * cell_folds: hide a code cell's input, its output, or both, on the selected cells or on every
 * cell. Each fold is a named action, and the cell_folds_key_system nbconfig setting picks which
 * command-mode keys reach them. Holding shift acts on every cell.
 *
 * An input fold is a class on the cell, so it leaves the notebook clean and lasts for the session.
 * An output fold is nbclassic's own collapse, which is saved with the notebook. When every code
 * cell's input is folded, the page becomes the outputs-only reading view.
 */
define([
    'require',
    'jquery',
    'base/js/namespace',
    'notebook/js/codecell',
], function (require, $, Jupyter, codecell) {
    "use strict";

    const CodeCell = codecell.CodeCell;
    const INPUT_FOLDED = 'input_folded';
    const OUTPUTS_ONLY = 'outputs_only';

    function loadStylesheet() {
        $('<link/>')
            .attr({rel: 'stylesheet', type: 'text/css', href: require.toUrl('./main.css')})
            .appendTo('head');
    }

    function codeCells(cells) {
        return cells.filter((cell) => cell instanceof CodeCell);
    }

    function updateReadingView() {
        let cells = codeCells(Jupyter.notebook.get_cells());
        let allFolded = cells.every((cell) => cell.element.hasClass(INPUT_FOLDED));
        $('body').toggleClass(OUTPUTS_ONLY, cells.length > 0 && allFolded);
    }

    function foldInputs(cells) {
        // keystrokes must not land in an editor that can no longer be seen
        Jupyter.notebook.command_mode();
        codeCells(cells).forEach((cell) => cell.element.addClass(INPUT_FOLDED));
        updateReadingView();
    }

    function unfoldInputs(cells) {
        codeCells(cells)
            .filter((cell) => cell.element.hasClass(INPUT_FOLDED))
            .forEach((cell) => {
                cell.element.removeClass(INPUT_FOLDED);
                // CodeMirror cannot measure itself while hidden
                cell.refresh();
            });
        updateReadingView();
    }

    function changeOutputs(cells, change) {
        let changing = codeCells(cells);
        changing.forEach(change);
        if (changing.length > 0) {
            Jupyter.notebook.set_dirty(true);
        }
    }

    function foldOutputs(cells) {
        changeOutputs(cells, (cell) => cell.collapse_output());
    }

    function unfoldOutputs(cells) {
        changeOutputs(cells, (cell) => cell.expand_output());
    }

    const TARGETS = {
        input: {label: 'input', fold: foldInputs, unfold: unfoldInputs},
        output: {label: 'output', fold: foldOutputs, unfold: unfoldOutputs},
        joint: {
            label: 'input and output',
            fold(cells) {
                foldInputs(cells);
                foldOutputs(cells);
            },
            unfold(cells) {
                unfoldInputs(cells);
                unfoldOutputs(cells);
            },
        },
    };

    const SCOPES = {
        selected: {label: 'selected cells', cells: () => Jupyter.notebook.get_selected_cells()},
        all: {label: 'all cells', cells: () => Jupyter.notebook.get_cells()},
    };

    const DEFAULT_KEY_SYSTEM = 'separate';
    const KEY_SYSTEMS = {
        separate: {
            input: {fold: '-', unfold: '='},
            output: {fold: '[', unfold: ']'},
            joint: {fold: ';', unfold: "'"},
        },
        chords: {
            input: {fold: 'cmdtrl--', unfold: 'cmdtrl-='},
            output: {fold: 'alt--', unfold: 'alt-='},
            joint: {fold: 'cmdtrl-alt--', unfold: 'cmdtrl-alt-='},
        },
    };

    const SCOPE_MODIFIERS = {selected: '', all: 'shift-'};
    const DIRECTIONS = ['fold', 'unfold'];
    const ACTION_PREFIX = 'cell_folds';

    function actionName(direction, targetName, scopeName) {
        return `${direction}-${targetName}-of-${scopeName}`;
    }

    function registerActions() {
        let actions = Jupyter.keyboard_manager.actions;
        for (let [targetName, target] of Object.entries(TARGETS)) {
            for (let [scopeName, scope] of Object.entries(SCOPES)) {
                for (let direction of DIRECTIONS) {
                    actions.register({
                        help: `${direction} ${target.label} of ${scope.label}`,
                        handler: () => target[direction](scope.cells()),
                    }, actionName(direction, targetName, scopeName), ACTION_PREFIX);
                }
            }
        }
    }

    function keySystem() {
        let name = Jupyter.notebook.config.data.cell_folds_key_system || DEFAULT_KEY_SYSTEM;
        if (Object.hasOwn(KEY_SYSTEMS, name)) {
            return KEY_SYSTEMS[name];
        }
        console.warn(`cell_folds: unknown key system ${name}, using ${DEFAULT_KEY_SYSTEM}`);
        return KEY_SYSTEMS[DEFAULT_KEY_SYSTEM];
    }

    function bindKeys() {
        let shortcuts = Jupyter.keyboard_manager.command_shortcuts;
        for (let [targetName, keys] of Object.entries(keySystem())) {
            for (let [scopeName, modifier] of Object.entries(SCOPE_MODIFIERS)) {
                for (let direction of DIRECTIONS) {
                    shortcuts.add_shortcut(
                        modifier + keys[direction],
                        `${ACTION_PREFIX}:${actionName(direction, targetName, scopeName)}`);
                }
            }
        }
    }

    function revealOnEdit() {
        let focusEditor = CodeCell.prototype.focus_editor;
        CodeCell.prototype.focus_editor = function () {
            unfoldInputs([this]);
            focusEditor.apply(this, arguments);
        };
    }

    function load_jupyter_extension() {
        loadStylesheet();
        registerActions();
        revealOnEdit();
        return Jupyter.notebook.config.loaded.then(bindKeys);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

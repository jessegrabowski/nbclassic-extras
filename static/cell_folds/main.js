/*
 * cell_folds: hide a code cell's input, its output, or both, on the selected cells or on every
 * cell. Each fold is a named action, and the cell_folds_key_system nbconfig setting picks which
 * command-mode keys reach them. Holding shift acts on every cell. In edit mode, Cmd-minus and
 * Cmd-equals fold and unfold the code block at the cursor, whatever the setting.
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
    'codemirror/lib/codemirror',
    'codemirror/addon/fold/foldcode',
    'codemirror/addon/fold/indent-fold',
], function (require, $, Jupyter, codecell, CodeMirror) {
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

    function changeOutputs(cells, {collapsed}) {
        let changing = codeCells(cells).filter((cell) => cell.output_area.collapsed !== collapsed);
        changing.forEach((cell) => collapsed ? cell.collapse_output() : cell.expand_output());
        if (changing.length > 0) {
            Jupyter.notebook.set_dirty(true);
        }
    }

    function foldOutputs(cells) {
        changeOutputs(cells, {collapsed: true});
    }

    function unfoldOutputs(cells) {
        changeOutputs(cells, {collapsed: false});
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

    // scanUp also reaches blocks that end above the cursor, and those must not fold
    function blockAroundCursor(editor, position) {
        let block = CodeMirror.fold.indent(editor, position);
        return block && block.to.line >= editor.getCursor().line ? block : undefined;
    }

    // leaving clearOnEnter on would let an arrow key unfold a block by moving into it
    const BLOCK_FOLD_OPTIONS = {
        rangeFinder: blockAroundCursor,
        scanUp: true,
        clearOnEnter: false,
        widget: '...',
    };

    function selectedEditor() {
        return Jupyter.notebook.get_selected_cell().code_mirror;
    }

    function foldsOnCursorLine(editor) {
        let line = editor.getCursor().line;
        return editor.findMarks({line: line, ch: 0}, {line: line + 1, ch: 0})
            .filter((mark) => mark.__isFold);
    }

    function isExactly(mark, range) {
        let {from, to} = mark.find();
        return CodeMirror.cmpPos(from, range.from) === 0 && CodeMirror.cmpPos(to, range.to) === 0;
    }

    // a fold is atomic, so Backspace or Delete beside it would delete all of its hidden text
    function unfoldInsteadOfDeleting(editor, change) {
        // nbclassic's Backspace command deletes with no change origin, so test the text itself
        if (change.text.join('') !== '') {
            return;
        }
        let fold = editor.findMarks(change.from, change.to)
            .find((mark) => mark.__isFold && isExactly(mark, change));
        if (fold) {
            change.cancel();
            // beforeChange handlers must not alter what the editor displays
            setTimeout(() => fold.clear());
        }
    }

    function foldBlockAtCursor() {
        let editor = selectedEditor();
        if (foldsOnCursorLine(editor).length > 0) {
            return;
        }
        editor.foldCode(editor.getCursor(), BLOCK_FOLD_OPTIONS, 'fold');
        editor.off('beforeChange', unfoldInsteadOfDeleting);
        editor.on('beforeChange', unfoldInsteadOfDeleting);
        // CodeMirror leaves the cursor after the hidden text, on a line that cannot be seen
        let [fold] = foldsOnCursorLine(editor);
        if (fold) {
            editor.setCursor(fold.find().from);
        }
    }

    function unfoldBlockAtCursor() {
        foldsOnCursorLine(selectedEditor()).forEach((mark) => mark.clear());
    }

    const BLOCK_DIRECTIONS = {
        fold: {key: 'cmdtrl--', handler: foldBlockAtCursor},
        unfold: {key: 'cmdtrl-=', handler: unfoldBlockAtCursor},
    };

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
        for (let [direction, {handler}] of Object.entries(BLOCK_DIRECTIONS)) {
            actions.register({
                help: `${direction} code block at the cursor`,
                handler: handler,
            }, `${direction}-block`, ACTION_PREFIX);
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

    function bindBlockKeys() {
        let shortcuts = Jupyter.keyboard_manager.edit_shortcuts;
        for (let [direction, {key}] of Object.entries(BLOCK_DIRECTIONS)) {
            shortcuts.add_shortcut(key, `${ACTION_PREFIX}:${direction}-block`);
        }
    }

    function revealOnEdit() {
        let focusEditor = CodeCell.prototype.focus_editor;
        CodeCell.prototype.focus_editor = function () {
            unfoldInputs([this]);
            focusEditor.apply(this, arguments);
        };
    }

    // nbclassic toggles an output on a double click of its prompt overlay, and folds take no clicks
    function ignorePromptDoubleClicks() {
        Jupyter.notebook.container[0].addEventListener('dblclick', (event) => {
            if (event.target.closest('.out_prompt_overlay')) {
                event.stopPropagation();
            }
        }, true);
    }

    function load_jupyter_extension() {
        loadStylesheet();
        registerActions();
        revealOnEdit();
        ignorePromptDoubleClicks();
        return Jupyter.notebook.config.loaded.then(() => {
            bindKeys();
            bindBlockKeys();
        });
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

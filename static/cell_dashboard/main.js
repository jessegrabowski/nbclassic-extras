/*
 * cell_dashboard: send a code cell's outputs to a separate window, which shows a copy of them and
 * gets a new copy each time the cell finishes running. Nothing moves in the notebook's own page.
 * The toolbar button and the t key in command mode send the selected cell, and open the window
 * when none is open. Shift-t sends it to a pane stacked below another, for wide plots.
 *
 * The notebook and the window share a BroadcastChannel named from the notebook's path. The window
 * announces itself when it loads and gets every linked cell, so it can open or reload at any time.
 * The notebook keeps its links in memory, so reloading the notebook leaves the window's panes
 * unlinked.
 *
 * A link is a cell id, looked up whenever it is used, because nbclassic builds a new cell object
 * when a delete is undone. A cut and paste gives the cell a new id, so a pasted cell has to be sent
 * again.
 */
define([
    'base/js/namespace',
    'base/js/utils',
], function (Jupyter, utils) {
    "use strict";

    const DASHBOARD_PAGE = 'nbextensions/cell_dashboard/dashboard.html';
    const SEND_KEY = 't';
    const STACK_KEY = 'shift-t';

    function dashboardUrl(channelName) {
        let page = utils.url_path_join(Jupyter.notebook.base_url, DASHBOARD_PAGE);
        return `${page}?channel=${encodeURIComponent(channelName)}`;
    }

    // a stream is stored as it arrived, and nbclassic applies its overwrites only when it draws
    function asDrawn(output) {
        if (output.output_type !== 'stream') {
            return output;
        }
        return {...output, text: utils.fixOverwrittenChars(output.text)};
    }

    function firstTextLine(source) {
        return source.split('\n').find((line) => line.trim() !== '') ?? '';
    }

    // a linked cell may have been deleted from the notebook since it was sent
    function cellIndex(id) {
        let index = Jupyter.notebook.get_cells().findIndex((cell) => cell.id === id);
        return index === -1 ? null : index;
    }

    function paneMessage(cell) {
        return {
            type: 'pane',
            id: cell.id,
            index: cellIndex(cell.id),
            title: firstTextLine(cell.get_text()),
            outputs: cell.output_area.toJSON().map(asDrawn),
            trusted: cell.output_area.trusted,
        };
    }

    function jumpToCell(id) {
        let index = cellIndex(id);
        if (index !== null) {
            Jupyter.notebook.select(index);
            Jupyter.notebook.scroll_to_cell(index, 0);
        }
    }

    function showsDashboard(opened) {
        try {
            let address = new URL(opened.location.href, window.location.href);
            return address.pathname.endsWith(`/${DASHBOARD_PAGE}`);
        } catch (error) {
            // a window on another site hides its address
            return false;
        }
    }

    // a second click brings the open dashboard forward, where opening its address would reload it
    // and lose its arrangement
    function openDashboard(channelName) {
        let dashboard = window.open('', channelName, 'popup');
        if (dashboard === null) {
            return null;
        }
        if (!showsDashboard(dashboard)) {
            dashboard.location.href = dashboardUrl(channelName);
        }
        dashboard.focus();
        return dashboard;
    }

    // inserts, deletes, and moves all add or remove children of the notebook container
    function onCellListChange(callback) {
        new MutationObserver(callback).observe(Jupyter.notebook.container[0], {childList: true});
    }

    // opening stays in the command palette, since sending opens the window the first time
    function registerActions(showDashboard, sendSelected) {
        Jupyter.keyboard_manager.actions.register({
            help: 'open the cell dashboard',
            icon: 'fa-columns',
            handler: showDashboard,
        }, 'open-dashboard', 'cell_dashboard');
        let send = Jupyter.keyboard_manager.actions.register({
            help: 'send the selected code cell to the dashboard, opening it if needed',
            icon: 'fa-share-square-o',
            handler: () => sendSelected(null),
        }, 'send-cell-to-dashboard', 'cell_dashboard');
        let stack = Jupyter.keyboard_manager.actions.register({
            help: 'send the selected code cell to a dashboard pane stacked below another',
            icon: 'fa-share-square-o',
            handler: () => sendSelected('bottom'),
        }, 'stack-cell-in-dashboard', 'cell_dashboard');
        Jupyter.toolbar.add_buttons_group([send]);
        Jupyter.keyboard_manager.command_shortcuts.add_shortcut(SEND_KEY, send);
        Jupyter.keyboard_manager.command_shortcuts.add_shortcut(STACK_KEY, stack);
    }

    function load_jupyter_extension() {
        let channelName = `cell_dashboard:${Jupyter.notebook.notebook_path}`;
        let channel = new BroadcastChannel(channelName);
        let linkedIds = new Set();
        let dashboard = null;

        let sendCell = (cell, edge = null) => channel.postMessage({...paneMessage(cell), edge});
        let sendLinked = (id) => {
            let index = cellIndex(id);
            if (index !== null) {
                sendCell(Jupyter.notebook.get_cell(index));
            }
        };
        let showDashboard = () => {
            dashboard = openDashboard(channelName);
        };
        // bringing an open window forward on every send would take the keyboard from the notebook
        let sendSelected = (edge) => {
            let cell = Jupyter.notebook.get_selected_cell();
            if (cell.cell_type !== 'code') {
                return;
            }
            linkedIds.add(cell.id);
            sendCell(cell, edge);
            if (dashboard === null || dashboard.closed) {
                showDashboard();
            }
        };

        channel.onmessage = ({data}) => {
            if (data.type === 'ready') {
                linkedIds.forEach(sendLinked);
            } else if (data.type === 'unlink') {
                linkedIds.delete(data.id);
            } else if (data.type === 'jump') {
                jumpToCell(data.id);
            }
        };
        onCellListChange(() => {
            let indices = [...linkedIds].map((id) => [id, cellIndex(id)]);
            channel.postMessage({type: 'indices', indices});
        });
        Jupyter.notebook.events.on('finished_execute.CodeCell', (event, {cell}) => {
            if (linkedIds.has(cell.id)) {
                sendCell(cell);
            }
        });
        registerActions(showDashboard, sendSelected);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

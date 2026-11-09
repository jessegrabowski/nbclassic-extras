/*
 * cell_dashboard: send a code cell's outputs to a separate window, which shows a copy of them and
 * gets a new copy each time the cell finishes running. Nothing moves in the notebook's own page.
 * The toolbar button and the t key in command mode send the selected cell, and open the window
 * when none is open. Shift-t sends it to a pane stacked below another, for wide plots.
 *
 * The notebook and the window share a BroadcastChannel named from the notebook's path. Each side
 * announces itself when it loads. The window gets every linked cell, and the notebook takes back
 * the links for the window's panes, so either side can open or reload at any time. A linked cell
 * carries a marker in the notebook.
 *
 * A link is a cell id, looked up whenever it is used, because nbclassic builds a new cell object
 * when a delete is undone. A cut and paste gives the cell a new id, so a pasted cell has to be sent
 * again.
 *
 * renders.js redraws matplotlib figures at the size of their panes, in Python kernels. A cell
 * tagged dashboard-no-redraw keeps the picture it drew, and costs the kernel nothing to hold.
 */
define([
    'require',
    'base/js/namespace',
    'base/js/utils',
    './renders',
], function (require, Jupyter, utils, renders) {
    "use strict";

    const DASHBOARD_PAGE = 'nbextensions/cell_dashboard/dashboard.html';
    const LINKED_CLASS = 'cell_dashboard_linked';
    const SEND_KEY = 't';
    const STACK_KEY = 'shift-t';

    function loadStylesheet() {
        let link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = require.toUrl('./main.css');
        document.head.append(link);
    }

    // an undone delete builds a new cell element, so markers follow the ids, not the elements
    function markLinked(linkedIds) {
        Jupyter.notebook.get_cells().forEach((cell) => {
            cell.element.toggleClass(LINKED_CLASS, linkedIds.has(cell.id));
        });
    }

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

    function afterNotebookLoads(callback) {
        if (Jupyter.notebook._fully_loaded) {
            callback();
        } else {
            Jupyter.notebook.events.one('notebook_loaded.Notebook', callback);
        }
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
        loadStylesheet();
        let channelName = `cell_dashboard:${Jupyter.notebook.notebook_path}`;
        let channel = new BroadcastChannel(channelName);
        let linkedIds = new Set();
        let dashboard = null;
        let figures = renders.startRenders((id) => linkedIds.has(id),
                                           (message) => channel.postMessage(message));

        let sendCell = (cell, edge = null) => channel.postMessage({...paneMessage(cell), edge});
        let sendLinked = (id) => {
            let index = cellIndex(id);
            if (index !== null) {
                sendCell(Jupyter.notebook.get_cell(index));
            }
        };
        // a pane whose cell is gone stays unlinked, and its missing index marks it in the window
        let relinkPanes = (ids) => {
            ids.filter((id) => cellIndex(id) !== null).forEach((id) => linkedIds.add(id));
            markLinked(linkedIds);
            figures.loadHelper();
            ids.forEach(sendLinked);
            channel.postMessage({type: 'indices', indices: ids.map((id) => [id, cellIndex(id)])});
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
            markLinked(linkedIds);
            figures.loadHelper();
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
                markLinked(linkedIds);
            } else if (data.type === 'panes') {
                relinkPanes(data.ids);
            } else if (data.type === 'jump') {
                jumpToCell(data.id);
            } else if (data.type === 'render') {
                figures.request(data);
            }
        };
        onCellListChange(() => {
            markLinked(linkedIds);
            let indices = [...linkedIds].map((id) => [id, cellIndex(id)]);
            channel.postMessage({type: 'indices', indices});
        });
        Jupyter.notebook.events.on('finished_execute.CodeCell', (event, {cell}) => {
            if (linkedIds.has(cell.id)) {
                sendCell(cell);
            }
        });
        registerActions(showDashboard, sendSelected);
        // the dashboard's pane ids can only be matched once the notebook's cells exist
        afterNotebookLoads(() => channel.postMessage({type: 'hello'}));
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

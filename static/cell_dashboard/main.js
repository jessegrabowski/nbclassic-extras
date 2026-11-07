/*
 * cell_dashboard: send a code cell's outputs to a separate window, which shows a copy of them and
 * gets a new copy each time the cell finishes running. Nothing moves in the notebook's own page.
 *
 * The notebook and the window share a BroadcastChannel named from the notebook's path. The window
 * announces itself when it loads, so either side can open or reload first.
 */
define([
    'base/js/namespace',
    'base/js/utils',
], function (Jupyter, utils) {
    "use strict";

    const DASHBOARD_PAGE = 'nbextensions/cell_dashboard/dashboard.html';

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

    function paneMessage(cell) {
        return {
            type: 'pane',
            title: cell.get_text().split('\n')[0],
            outputs: cell.output_area.toJSON().map(asDrawn),
            trusted: cell.output_area.trusted,
        };
    }

    function registerActions(channelName, linkCell) {
        let open = Jupyter.keyboard_manager.actions.register({
            help: 'open the cell dashboard',
            icon: 'fa-columns',
            // the shared name reuses this notebook's dashboard window on a second click
            handler: () => window.open(dashboardUrl(channelName), channelName),
        }, 'open-dashboard', 'cell_dashboard');
        let send = Jupyter.keyboard_manager.actions.register({
            help: 'send the selected code cell to the dashboard',
            icon: 'fa-share-square-o',
            handler: () => linkCell(Jupyter.notebook.get_selected_cell()),
        }, 'send-cell-to-dashboard', 'cell_dashboard');
        Jupyter.toolbar.add_buttons_group([open, send]);
    }

    function load_jupyter_extension() {
        let channelName = `cell_dashboard:${Jupyter.notebook.notebook_path}`;
        let channel = new BroadcastChannel(channelName);
        let linkedCell = null;

        let sendLinkedCell = () => {
            if (linkedCell !== null) {
                channel.postMessage(paneMessage(linkedCell));
            }
        };
        let linkCell = (cell) => {
            if (cell.cell_type === 'code') {
                linkedCell = cell;
                sendLinkedCell();
            }
        };

        channel.onmessage = ({data}) => {
            if (data.type === 'ready') {
                sendLinkedCell();
            }
        };
        Jupyter.notebook.events.on('finished_execute.CodeCell', (event, {cell}) => {
            if (cell === linkedCell) {
                sendLinkedCell();
            }
        });
        registerActions(channelName, linkCell);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

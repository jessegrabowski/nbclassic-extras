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

    function registerActions(channelName) {
        let open = Jupyter.keyboard_manager.actions.register({
            help: 'open the cell dashboard',
            icon: 'fa-columns',
            // the shared name reuses this notebook's dashboard window on a second click
            handler: () => window.open(dashboardUrl(channelName), channelName),
        }, 'open-dashboard', 'cell_dashboard');
        Jupyter.toolbar.add_buttons_group([open]);
    }

    function load_jupyter_extension() {
        let channelName = `cell_dashboard:${Jupyter.notebook.notebook_path}`;
        new BroadcastChannel(channelName);
        registerActions(channelName);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

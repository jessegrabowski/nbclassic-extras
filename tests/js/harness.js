// Loads static/rise/main.js in a jsdom page with real jQuery (nbclassic's own copy) and a fake
// Jupyter whose notebook, config, keyboard manager, actions, and dialogs hold state. Tests drive
// RISE only through what setup() registers and assert on the resulting DOM and Jupyter state.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const REPO_ROOT = path.join(__dirname, "..", "..");
const MAIN_JS = fs.readFileSync(path.join(REPO_ROOT, "static", "rise", "main.js"), "utf8");
const JQUERY_PATH = path.join(nbclassicStatic(), "components", "jquery", "jquery.min.js");
const JQUERY_JS = fs.readFileSync(JQUERY_PATH, "utf8");

function nbclassicStatic() {
    const prefix = process.env.CONDA_PREFIX;
    if (!prefix) {
        throw new Error("CONDA_PREFIX is unset; run the JS tests through `pixi run js-test`");
    }
    const lib = path.join(prefix, "lib");
    const python = fs.readdirSync(lib).find((name) => /^python3\.\d+$/.test(name));
    return path.join(lib, python, "site-packages", "nbclassic", "static");
}

const PAGE = `<!DOCTYPE html><html><head></head><body>
<div id="header"></div>
<div id="maintoolbar"></div>
<div id="notebook"><div id="notebook-container"></div><div class="end_space"></div></div>
</body></html>`;

// A slide_type of undefined leaves the cell without slideshow metadata.
function cell(source, slideType, cellType = "markdown") {
    const metadata = slideType === undefined ? {} : { slideshow: { slide_type: slideType } };
    return { source: source, cellType: cellType, metadata: metadata };
}

class FakeShortcuts {
    constructor() {
        this.bindings = new Map();
    }

    add_shortcut(key, action) {
        this.bindings.set(key, action);
    }

    set_shortcut(key, action) {
        this.bindings.set(key, action);
    }

    remove_shortcut(key) {
        this.bindings.delete(key);
    }
}

function makeCells($, specs) {
    const container = $("#notebook-container");
    return specs.map((spec, index) => {
        const element = $('<div class="cell"></div>').text(spec.source).appendTo(container);
        return {
            cell_type: spec.cellType,
            metadata: spec.metadata,
            element: element,
            selected: index === 0,
            rendered: true,
            select() { this.selected = true; },
            unselect() { this.selected = false; },
            render() { this.rendered = true; },
            unrender() { this.rendered = false; },
            ensure_focused() {},
        };
    });
}

function makeNotebook(cells, metadata, notebookConfig, shortcuts, actions) {
    return {
        notebook_name: "slides.ipynb",
        metadata: metadata,
        config: configSection(notebookConfig),
        keyboard_manager: {
            actions: actions,
            command_shortcuts: shortcuts.command,
            edit_shortcuts: shortcuts.edit,
        },
        get_cells: () => cells,
        get_selected_index() {
            const index = cells.findIndex((c) => c.selected);
            return index === -1 ? null : index;
        },
        get_selected_cell: () => cells.find((c) => c.selected) ?? null,
        select(index) {
            cells.forEach((c, i) => (i === Number(index) ? c.select() : c.unselect()));
        },
    };
}

function configSection(data) {
    return { data: data, loaded: Promise.resolve(), load() {} };
}

// Holds the slide reveal is showing, so RISE's own lookups of the current slide work. Tests never
// assert on it: the reveal API changes when RISE moves to reveal.js 6.
function makeReveal(window) {
    let current = null;
    return {
        initialize() {},
        configure() {},
        addEventListener() {},
        removeEventListeners() {},
        sync() {},
        slide(h, v) {
            current = window.document.getElementById(`slide-${h}-${v || 0}`);
        },
        getCurrentSlide: () => current,
        getConfig: () => ({ width: 960, height: 700 }),
    };
}

/**
 * Load RISE into a fresh page and wait for its setup to finish.
 *
 * @param {object} options
 * @param {Array} options.cells - cell specs from cell().
 * @param {object} [options.metadata] - notebook metadata.
 * @param {object} [options.sections] - nbconfig sections by name, e.g. {rise: {...}}.
 * @param {object} [options.notebookConfig] - Jupyter.notebook.config data.
 */
async function loadRise({ cells, metadata = {}, sections = {}, notebookConfig = {} }) {
    const dom = new JSDOM(PAGE, {
        url: "http://localhost:8888/notebooks/slides.ipynb",
        runScripts: "outside-only",
        pretendToBeVisual: true,
    });
    const window = dom.window;
    window.eval(JQUERY_JS);
    const $ = window.jQuery;

    const actions = new Map();
    const actionRegistry = {
        register(action, name, prefix) {
            actions.set(`${prefix}:${name}`, action);
        },
    };
    const shortcuts = { command: new FakeShortcuts(), edit: new FakeShortcuts() };
    const notebookCells = makeCells($, cells);
    const notebook = makeNotebook(notebookCells,
                                  metadata,
                                  notebookConfig,
                                  shortcuts,
                                  actionRegistry);
    const Jupyter = {
        notebook: notebook,
        keyboard_manager: notebook.keyboard_manager,
        toolbar: { add_buttons_group() {} },
        dialog: { modal() {} },
        CellToolbar: { rebuild_all() {} },
    };
    const configmod = {
        ConfigSection: function (name) {
            return configSection(sections[name] || {});
        },
    };
    const utils = { get_body_data: () => "" };
    const fakeRequire = (deps, callback) => callback();
    fakeRequire.toUrl = (url) => url;

    window.Reveal = makeReveal(window);
    let factory = null;
    window.define = (deps, body) => {
        factory = body;
    };
    window.eval(MAIN_JS);
    const setup = factory(fakeRequire, $, Jupyter, utils, configmod);
    setup();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    return {
        $: $,
        cells: notebookCells,
        run(actionName) {
            const action = actions.get(actionName);
            if (!action) {
                throw new Error(`no action registered as ${actionName}`);
            }
            action.handler();
        },
        close: () => window.close(),
    };
}

module.exports = { cell, loadRise };

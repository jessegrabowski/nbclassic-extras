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
        const cell = {
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
        element.data("cell", cell);
        return cell;
    });
}

// Mirrors nbclassic's Notebook: cells are read back from the DOM through get_cell_elements, which
// RISE overrides on the prototype. A class per page keeps that override from leaking across tests.
function makeNotebook($, metadata, notebookConfig, shortcuts, actions) {
    class FakeNotebook {
        constructor() {
            this.container = $("#notebook-container");
            this.notebook_name = "slides.ipynb";
            this.metadata = metadata;
            this.config = configSection(notebookConfig);
            this.keyboard_manager = {
                actions: actions,
                command_shortcuts: shortcuts.command,
                edit_shortcuts: shortcuts.edit,
            };
        }

        get_cell_elements() {
            return this.container.find(".cell").not(".cell .cell");
        }

        get_cells() {
            return this.get_cell_elements().toArray().map((element) => $(element).data("cell"));
        }

        get_selected_index() {
            const index = this.get_cells().findIndex((cell) => cell.selected);
            return index === -1 ? null : index;
        }

        get_selected_cell() {
            return this.get_cells().find((cell) => cell.selected) ?? null;
        }

        // Same validity check as nbclassic's is_valid_cell_index: null or out of range keeps the
        // selection, and numeric strings (RISE passes for...in keys) count as indices.
        select(index) {
            const cells = this.get_cells();
            if (index === null || !(index >= 0 && index < cells.length)) {
                return;
            }
            cells.forEach((cell, i) => {
                if (i === Number(index)) {
                    cell.select();
                } else {
                    cell.unselect();
                }
            });
        }
    }
    return new FakeNotebook();
}

function configSection(data) {
    return { data: data, loaded: Promise.resolve(), load() {} };
}

// Holds the slide reveal is showing and fires its ready event, so RISE's own lookups and
// listeners work. Tests never assert on it: the reveal API changes when RISE moves to reveal.js 6.
function makeReveal(window) {
    let current = null;
    let listeners = [];
    return {
        initialize() {
            const fireReady = () => listeners
                .filter((listener) => listener.name === "ready")
                .forEach((listener) => listener.callback());
            window.setTimeout(fireReady, 0);
        },
        configure() {},
        addEventListener(name, callback) {
            listeners.push({ name: name, callback: callback });
        },
        removeEventListeners() {
            listeners = [];
        },
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
    const notebook = makeNotebook($, metadata, notebookConfig, shortcuts, actionRegistry);
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
        idle: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
        close: () => window.close(),
    };
}

module.exports = { cell, loadRise };

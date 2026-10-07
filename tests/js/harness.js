// Loads static/rise/main.js in a jsdom page with nbclassic's own jQuery and shortcut manager and a
// fake Jupyter whose notebook, config, actions, and dialogs hold state. Tests drive RISE only
// through what setup() registers and assert on the resulting DOM and Jupyter state.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO_ROOT = path.join(__dirname, "..", "..");
const MAIN_JS = fs.readFileSync(path.join(REPO_ROOT, "static", "rise", "main.js"), "utf8");
const NBCLASSIC_STATIC = nbclassicStatic();
const JQUERY_JS = readStatic("components", "jquery", "jquery.min.js");
const UNDERSCORE_JS = readStatic("components", "underscore", "underscore-min.js");
const KEYBOARD_JS = readStatic("base", "js", "keyboard.js");

function readStatic(...parts) {
    return fs.readFileSync(path.join(NBCLASSIC_STATIC, ...parts), "utf8");
}

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

// jsdom only logs an error a page's script throws in a timer or event handler; this console
// records it, and closePage rethrows it so the test fails.
function strictConsole() {
    const virtualConsole = new VirtualConsole();
    const errors = [];
    virtualConsole.forwardTo(console, { jsdomErrors: "none" });
    virtualConsole.on("jsdomError", (error) => {
        if (error.type === "unhandled-exception") {
            errors.push(error.cause ?? error);
        }
    });
    const closePage = (window) => {
        window.close();
        if (errors.length > 0) {
            throw errors[0];
        }
    };
    return { virtualConsole: virtualConsole, closePage: closePage };
}

// A slide_type of undefined leaves the cell without slideshow metadata.
function cell(source, slideType, cellType = "markdown") {
    const metadata = slideType === undefined ? {} : { slideshow: { slide_type: slideType } };
    return { source: source, cellType: cellType, metadata: metadata };
}

class FakeEvents {
    constructor() {
        this.handlers = new Map();
    }

    one(name, handler) {
        this.handlers.set(name, [...(this.handlers.get(name) || []), handler]);
    }

    trigger(name) {
        const handlers = this.handlers.get(name) || [];
        this.handlers.delete(name);
        handlers.forEach((handler) => handler());
    }
}

// nbclassic's default bindings for the keys RISE rebinds, for keys a custom reveal shortcut can
// collide with, and for multi-key shortcuts; every other key starts unbound.
const NBCLASSIC_COMMAND_SHORTCUTS = {
    "shift-enter": "jupyter-notebook:run-cell-and-select-next",
    s: "jupyter-notebook:save-notebook",
    q: "jupyter-notebook:close-pager",
    f: "jupyter-notebook:find-and-replace",
    a: "jupyter-notebook:insert-cell-above",
    "i,i": "jupyter-notebook:interrupt-kernel",
    "0,0": "jupyter-notebook:confirm-restart-kernel",
    "d,d": "jupyter-notebook:delete-cell",
};
const NBCLASSIC_EDIT_SHORTCUTS = {
    "shift-enter": "jupyter-notebook:run-cell-and-select-next",
};

// Load nbclassic's base/js/keyboard module, as a Chrome page on Linux sees it.
function loadKeyboard(window, $) {
    window.eval(UNDERSCORE_JS);
    let factory = null;
    window.define = (deps, body) => {
        factory = body;
    };
    window.eval(KEYBOARD_JS);
    return factory($, { browser: ["Chrome"], platform: "Linux" }, window._);
}

function shortcutManager(keyboard, defaults) {
    const manager = new keyboard.ShortcutManager(undefined,
                                                 { trigger() {} },
                                                 { extend_env() {}, get_name: (name) => name });
    for (const [key, action] of Object.entries(defaults)) {
        manager.set_shortcut(key, action);
    }
    return manager;
}

// Every binding of `manager` as {"i,i": action, ...}.
function flatShortcuts(manager) {
    const flatten = (tree, prefix) => Object.entries(tree).flatMap(([key, node]) => {
        const shortcut = prefix + key;
        return typeof node === "string" ? [[shortcut, node]] : flatten(node, `${shortcut},`);
    });
    return Object.fromEntries(flatten(manager._shortcuts, ""));
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
function makeNotebook($, metadata, notebookConfig, shortcuts, actions, loaded) {
    class FakeNotebook {
        constructor() {
            this.container = $("#notebook-container");
            this.notebook_name = "slides.ipynb";
            this._fully_loaded = loaded;
            this.metadata = loaded ? metadata : {};
            this.events = new FakeEvents();
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

        // Like nbclassic, the last selected cell wins.
        get_selected_index() {
            const index = this.get_cells().findLastIndex((cell) => cell.selected);
            return index === -1 ? null : index;
        }

        get_selected_cell() {
            return this.get_cells().findLast((cell) => cell.selected) ?? null;
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
// listeners work. Tests assert only on the listeners RISE leaves registered, since the rest of the
// reveal API changes when RISE moves to reveal.js 6.
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
        removeEventListener(name, callback) {
            listeners = listeners.filter((l) => l.name !== name || l.callback !== callback);
        },
        listenerCount: (name) => listeners.filter((listener) => listener.name === name).length,
        // Like reveal's, this unbinds reveal's own input handlers and leaves added listeners alone.
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
 * @param {boolean} [options.notebookLoaded] - false holds back the notebook's metadata, as
 *     nbclassic does while the notebook JSON is still loading, until finishNotebookLoad().
 */
async function loadRise({
    cells,
    metadata = {},
    sections = {},
    notebookConfig = {},
    notebookLoaded = true,
}) {
    const { virtualConsole, closePage } = strictConsole();
    const dom = new JSDOM(PAGE, {
        url: "http://localhost:8888/notebooks/slides.ipynb",
        runScripts: "outside-only",
        pretendToBeVisual: true,
        virtualConsole: virtualConsole,
    });
    const window = dom.window;
    window.eval(JQUERY_JS);
    const $ = window.jQuery;
    const keyboard = loadKeyboard(window, $);

    const actions = new Map();
    const actionRegistry = {
        register(action, name, prefix) {
            actions.set(`${prefix}:${name}`, action);
        },
    };
    const shortcuts = {
        command: shortcutManager(keyboard, NBCLASSIC_COMMAND_SHORTCUTS),
        edit: shortcutManager(keyboard, NBCLASSIC_EDIT_SHORTCUTS),
    };
    const notebookCells = makeCells($, cells);
    const notebook = makeNotebook($,
                                  metadata,
                                  notebookConfig,
                                  shortcuts,
                                  actionRegistry,
                                  notebookLoaded);
    const dialogs = [];
    const Jupyter = {
        notebook: notebook,
        keyboard_manager: notebook.keyboard_manager,
        toolbar: { add_buttons_group() {} },
        dialog: { modal: (options) => dialogs.push(options) },
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
    const setup = factory(fakeRequire, $, Jupyter, utils, configmod, keyboard);
    setup();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    return {
        $: $,
        cells: notebookCells,
        shortcuts: shortcuts,
        shortcutMap: (mode) => flatShortcuts(shortcuts[mode]),
        dialogs: dialogs,
        run(actionName) {
            const action = actions.get(actionName);
            if (!action) {
                throw new Error(`no action registered as ${actionName}`);
            }
            action.handler();
        },
        revealListenerCount: (name) => window.Reveal.listenerCount(name),
        showSlide: (h, v) => window.Reveal.slide(h, v),
        finishNotebookLoad() {
            notebook.metadata = metadata;
            notebook._fully_loaded = true;
            notebook.events.trigger("notebook_loaded.Notebook");
        },
        idle: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
        close: () => closePage(window),
    };
}

/**
 * Load a reveal.js plugin script from static/rise into a fresh page with a fake Reveal.
 *
 * @param {string} relativePath - script path under static/rise.
 * @param {string} slidesHtml - markup placed inside div.reveal > div.slides.
 * @param {object} [options.config] - what Reveal.getConfig() returns.
 * @param {boolean} [options.popupBlocked] - window.open returns null when true.
 * @param {string} [options.query] - query string on the script's URL, as a cache-buster adds.
 */
function loadRevealPlugin(relativePath,
                          slidesHtml,
                          { config = {}, popupBlocked = false, query = "" } = {}) {
    const scriptUrl = `http://localhost:8888/nbextensions/rise/${relativePath}${query}`;
    const { virtualConsole, closePage } = strictConsole();
    const dom = new JSDOM(
        `<!DOCTYPE html><html><head><script src="${scriptUrl}"></script></head><body>
        <div class="reveal"><div class="slides">${slidesHtml}</div></div></body></html>`,
        {
            url: "http://localhost:8888/notebooks/slides.ipynb",
            runScripts: "outside-only",
            virtualConsole: virtualConsole,
        },
    );
    const window = dom.window;
    const popups = [];
    const alerts = [];
    const listeners = [];
    let current = window.document.querySelector(".slides section section");
    window.open = (url, name) => {
        if (popupBlocked) {
            return null;
        }
        const popup = { url: url, name: name, messages: [], closed: false, focused: 0 };
        popup.postMessage = (message) => popup.messages.push(JSON.parse(message));
        popup.focus = () => (popup.focused += 1);
        popups.push(popup);
        return popup;
    };
    window.alert = (message) => alerts.push(message);
    // jsdom has no canvas: give plugins a 2D context whose drawing calls do nothing.
    const noOpContext = new Proxy({}, { get: (target, name) => target[name] ?? (() => {}) });
    window.HTMLCanvasElement.prototype.getContext = () => noOpContext;
    const downloads = [];
    window.URL.createObjectURL = (blob) => {
        downloads.push(blob);
        return "blob:download";
    };
    window.Reveal = {
        registerPlugin() {},
        getConfig: () => config,
        getState: () => ({ indexh: 0, indexv: 0 }),
        getCurrentSlide: () => current,
        getRevealElement: () => window.document.querySelector(".reveal"),
        addKeyBinding() {},
        addEventListener: (name, callback) => listeners.push({ name: name, callback: callback }),
    };
    window.eval(fs.readFileSync(path.join(REPO_ROOT, "static", "rise", relativePath), "utf8"));
    return {
        window: window,
        popups: popups,
        alerts: alerts,
        downloads: downloads,
        // Make `selector` the current slide and fire reveal's event, as reveal does on navigation.
        showSlide(selector, eventName = "slidechanged") {
            current = window.document.querySelector(selector);
            listeners
                .filter((listener) => listener.name === eventName)
                .forEach((listener) => listener.callback());
        },
        // Deliver a message as if the notes popup had posted it to this window.
        receive(data) {
            const message = new window.MessageEvent("message", { data: JSON.stringify(data) });
            window.dispatchEvent(message);
        },
        close: () => closePage(window),
    };
}

module.exports = { cell, loadRise, loadRevealPlugin };

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
const SANITIZER_JS = readStatic("components", "sanitizer", "index.js");
const SECURITY_JS = readStatic("base", "js", "security.js");

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
        this.handlers = [];
    }

    on(name, handler) {
        this.handlers.push({ name: name, handler: handler, once: false });
    }

    one(name, handler) {
        this.handlers.push({ name: name, handler: handler, once: true });
    }

    trigger(name, data) {
        const matching = this.handlers.filter((entry) => entry.name === name);
        this.handlers = this.handlers.filter((entry) => entry.name !== name || !entry.once);
        matching.forEach((entry) => entry.handler({ type: name }, data));
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

// Load nbclassic's base/js/security module and the sanitizer bundle it wraps.
function loadSecurity(window, $) {
    let factory = null;
    window.define = (...args) => {
        factory = args[args.length - 1];
    };
    window.eval(SANITIZER_JS);
    const sanitizer = factory();
    window.eval(SECURITY_JS);
    return factory($, sanitizer);
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
            code_mirror: { refresh() {} },
        };
        element.data("cell", cell);
        return cell;
    });
}

// Mirrors nbclassic's Notebook: cells are read back from the DOM through get_cell_elements.
function makeNotebook($, { metadata, notebookConfig, shortcuts, actions, loaded, name, trusted }) {
    class FakeNotebook {
        constructor() {
            this.container = $("#notebook-container");
            this.notebook_name = name;
            this.trusted = trusted;
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

        // Like nbclassic, whose get_cell(null) reads the first cell element, with no cell
        // selected this returns the first cell.
        get_selected_cell() {
            return this.get_cells()[this.get_selected_index() ?? 0] ?? null;
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

// Holds the slide reveal is showing and, like reveal, fires its ready event once each
// initialize finishes starting, unless destroy() came first. Tests assert only on the listeners
// RISE leaves registered, not on calls into reveal.
function makeReveal(window) {
    let current = null;
    let listeners = [];
    let initialized = false;
    return {
        initialize() {
            if (initialized) {
                throw new Error("Reveal.js has already been initialized.");
            }
            initialized = true;
            return new Promise((resolve) => window.setTimeout(() => {
                if (!initialized) {
                    return;
                }
                listeners
                    .filter((listener) => listener.name === "ready")
                    .forEach((listener) => listener.callback());
                resolve();
            }, 0));
        },
        destroy() {
            initialized = false;
        },
        addEventListener(name, callback) {
            listeners.push({ name: name, callback: callback });
        },
        removeEventListener(name, callback) {
            listeners = listeners.filter((l) => l.name !== name || l.callback !== callback);
        },
        listenerCount: (name) => listeners.filter((listener) => listener.name === name).length,
        sync() {},
        slide(h, v) {
            current = window.document.getElementById(`slide-${h}-${v || 0}`);
        },
        getCurrentSlide: () => current,
        getPlugin: () => undefined,
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
 * @param {boolean} [options.revealLoaded] - false holds back reveal.js, as RequireJS does while
 *     it downloads, until finishRevealLoad().
 * @param {boolean} [options.revealLoadFails] - true fails every reveal.js load, as RequireJS
 *     does when a script cannot be fetched.
 * @param {string} [options.notebookName] - the notebook's file name.
 * @param {boolean} [options.trusted] - whether nbclassic trusts the notebook.
 */
async function loadRise({
    cells,
    metadata = {},
    sections = {},
    notebookConfig = {},
    notebookLoaded = true,
    revealLoaded = true,
    revealLoadFails = false,
    notebookName = "slides.ipynb",
    trusted = true,
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
    const security = loadSecurity(window, $);

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
    const notebook = makeNotebook($, {
        metadata: metadata,
        notebookConfig: notebookConfig,
        shortcuts: shortcuts,
        actions: actionRegistry,
        loaded: notebookLoaded,
        name: notebookName,
        trusted: trusted,
    });
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
    const reveal = makeReveal(window);
    const pendingLoads = [];
    const fakeRequire = (deps, callback, errback) => {
        if (revealLoadFails) {
            window.setTimeout(() => errback(new Error("script error")), 0);
        } else if (revealLoaded) {
            callback(reveal);
        } else {
            pendingLoads.push(() => callback(reveal));
        }
    };
    fakeRequire.toUrl = (url) => url;

    let factory = null;
    window.define = (deps, body) => {
        factory = body;
    };
    window.eval(MAIN_JS);
    const setup = factory(fakeRequire, $, Jupyter, utils, configmod, keyboard, security);
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
        revealListenerCount: (name) => reveal.listenerCount(name),
        showSlide: (h, v) => reveal.slide(h, v),
        finishRevealLoad() {
            pendingLoads.splice(0).forEach((load) => load());
        },
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
 * Load a reveal.js plugin script from static/rise into a fresh page, with a fake deck to init it.
 *
 * @param {string} relativePath - script path under static/rise.
 * @param {string} slidesHtml - markup placed inside div.reveal > div.slides.
 * @param {object} [options.config] - what deck.getConfig() returns.
 * @param {object} [options.context] - the 2D context every canvas returns; draws nothing by default.
 */
function loadRevealPlugin(relativePath,
                          slidesHtml,
                          { config = {}, context = null } = {}) {
    const { virtualConsole, closePage } = strictConsole();
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>
        <div class="reveal"><div class="slides">${slidesHtml}</div></div></body></html>`,
        {
            url: "http://localhost:8888/notebooks/slides.ipynb",
            runScripts: "outside-only",
            virtualConsole: virtualConsole,
        },
    );
    const window = dom.window;
    // jsdom has no canvas: give plugins a 2D context whose drawing calls do nothing.
    const noOpContext = new Proxy({}, { get: (target, name) => target[name] ?? (() => {}) });
    window.HTMLCanvasElement.prototype.getContext = () => context ?? noOpContext;
    const downloads = [];
    window.URL.createObjectURL = (blob) => {
        downloads.push(blob);
        return "blob:download";
    };
    const document = window.document;
    const listeners = [];
    const deck = {
        getConfig: () => config,
        getIndices: () => ({ h: 0, v: 0 }),
        getSlides: () => Array.from(document.querySelectorAll(".slides section section")),
        getSlidesElement: () => document.querySelector(".slides"),
        getTotalSlides: () => document.querySelectorAll(".slides section section").length,
        getCurrentSlide: () => document.querySelector(".slides section section"),
        isAutoSliding: () => false,
        addKeyBinding() {},
        addEventListener(name, callback) {
            listeners.push({ name: name, callback: callback });
        },
        emit(name) {
            listeners.filter((l) => l.name === name).forEach((l) => l.callback({}));
        },
    };
    window.eval(fs.readFileSync(path.join(REPO_ROOT, "static", "rise", relativePath), "utf8"));
    return {
        window: window,
        deck: deck,
        downloads: downloads,
        close: () => closePage(window),
    };
}

module.exports = { cell, loadRise, loadRevealPlugin };

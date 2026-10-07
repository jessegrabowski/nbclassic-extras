"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { cell, loadRise } = require("../harness");

// Texts of the cells directly inside `selector`, in DOM order. Built as a Node array because
// deepEqual rejects arrays created in the jsdom realm even when their contents match.
function cellTexts($, selector) {
    return Array.from($(selector).children(".cell"), (element) => element.textContent);
}

test("entering wraps cells in slide sections and exiting puts them back", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");
    assert.equal($("#notebook-container > section > section#slide-0-0").text(), "Alpha");

    rise.run("RISE:slideshow");
    assert.equal($("#notebook-container section").length, 0);
    assert.equal($("#notebook-container > .cell").text(), "Alpha");
});

test("a leading slide cell does not create an empty first slide", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide"), cell("Bravo", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.equal($("#notebook-container > section").length, 2);
    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-1-0"), ["Bravo"]);
});

test("a leading subslide cell stays on the first subslide", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "subslide"), cell("Bravo", "subslide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-1"), ["Bravo"]);
});

test("a leading fragment cell is shown with the first slide, not as a fragment", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "fragment"), cell("Bravo", "fragment")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-0 > div.fragment"), ["Bravo"]);
});

test("leading notes and skip cells do not count as first-slide content", async (t) => {
    const cells = [cell("Spoken", "notes"), cell("Skipped", "skip"), cell("Alpha", "slide")];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.equal($("#notebook-container > section").length, 1);
    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Skipped", "Alpha"]);
    assert.deepEqual(cellTexts($, "#slide-0-0 > aside.notes"), ["Spoken"]);
});

test("a fragment groups the regular cells that follow it", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "fragment"),
        cell("Charlie", ""),
        cell("Delta", "fragment"),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    const fragments = $("#slide-0-0 > div.fragment");
    assert.equal(fragments.length, 2);
    assert.deepEqual(cellTexts($, fragments.eq(0)), ["Bravo", "Charlie"]);
    assert.deepEqual(cellTexts($, fragments.eq(1)), ["Delta"]);
});

test("dash and unset slide types are regular cells", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "-"),
        cell("Charlie", "slide"),
        cell("Delta", undefined),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#slide-0-0"), ["Alpha", "Bravo"]);
    assert.deepEqual(cellTexts($, "#slide-1-0"), ["Charlie", "Delta"]);
    const tags = rise.cells.map((c) => c.smart_exec);
    assert.deepEqual(tags, [
        "smart_exec_next",
        "smart_exec_slide",
        "smart_exec_next",
        "smart_exec_slide",
    ]);
});

test("smart-exec tags look past notes and skip cells to the next visible cell", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", ""),
        cell("Spoken", "notes"),
        cell("Charlie", "fragment"),
        cell("Skipped", "skip"),
        cell("Delta", "slide"),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    const tags = rise.cells.map((c) => c.smart_exec);
    assert.deepEqual(tags, [
        "smart_exec_next",
        "smart_exec_fragment",
        "smart_exec_fragment",
        "smart_exec_slide",
        "smart_exec_slide",
        "smart_exec_slide",
    ]);
    assert.equal(rise.cells[1].smart_exec_next_fragment[0], $("div.fragment")[0]);
});

test("exiting keeps notebook order when a notes cell follows a fragment", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("Bravo", "fragment"),
        cell("Spoken", "notes"),
        cell("Charlie", ""),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");

    assert.deepEqual(cellTexts($, "#notebook-container"), ["Alpha", "Bravo", "Spoken", "Charlie"]);
});

["subslide", "fragment"].forEach((leadingType) => {
    const title = `auto-select finds the code cell when the notebook starts with a ${leadingType}`;
    test(title, async (t) => {
        const cells = [cell("Alpha", leadingType), cell("x = 1", "", "code")];
        const metadata = { rise: { auto_select_timeout: 0 } };
        const rise = await loadRise({ cells: cells, metadata: metadata });
        t.after(rise.close);

        rise.run("RISE:slideshow");
        await rise.idle(20);

        assert.deepEqual(rise.cells.map((c) => c.selected), [false, true]);
    });
});

// Config layers from lowest to highest precedence, each with the theme it sets.
const CONFIG_LAYERS = [
    ["nbconfig livereveal", "beige", (config, theme) => (config.sections.livereveal = { theme })],
    ["nbconfig rise", "blood", (config, theme) => (config.sections.rise = { theme })],
    ["notebook config rise", "league", (config, theme) => (config.notebookConfig.rise = { theme })],
    ["metadata livereveal", "moon", (config, theme) => (config.metadata.livereveal = { theme })],
    ["metadata rise", "night", (config, theme) => (config.metadata.rise = { theme })],
];

test("without any config the slideshow uses the simple theme", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.ok($("body").hasClass("theme-simple"));
    assert.match($("link#theme").attr("href"), /reveal\.js\/css\/theme\/simple\.css$/);
});

CONFIG_LAYERS.forEach(([layerName, layerTheme], top) => {
    test(`${layerName} takes precedence over the defaults and every lower layer`, async (t) => {
        const config = { sections: {}, notebookConfig: {}, metadata: {} };
        CONFIG_LAYERS.slice(0, top + 1).forEach(([, theme, apply]) => apply(config, theme));
        const rise = await loadRise({ cells: [cell("Alpha", "slide")], ...config });
        t.after(rise.close);
        const { $ } = rise;

        rise.run("RISE:slideshow");

        const bodyClasses = $("body").attr("class").split(/\s+/);
        const themes = bodyClasses.filter((name) => name.startsWith("theme-"));
        assert.deepEqual(themes, [`theme-${layerTheme}`]);
    });
});

test("nested settings from different config layers merge", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        sections: { rise: { shortcuts: { slideshow: "alt-q" } } },
        metadata: { rise: { shortcuts: { "toggle-slide": "shift-x" } } },
    });
    t.after(rise.close);

    const bindings = rise.shortcutMap("command");
    assert.equal(bindings["alt-q"], "RISE:slideshow");
    assert.equal(bindings["shift-x"], "RISE:toggle-slide");
    assert.equal(bindings["shift-b"], "RISE:toggle-subslide");
});

test("metadata config applies when the notebook finishes loading after RISE", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { theme: "night" } },
        notebookLoaded: false,
    });
    t.after(rise.close);
    const { $ } = rise;

    rise.finishNotebookLoad();
    await rise.idle(0);
    rise.run("RISE:slideshow");

    assert.ok($("body").hasClass("theme-night"));
});

test("header, backimage and footer are added to one overlay in that order", async (t) => {
    const metadata = { rise: { header: "Top", backimage: "back.png", footer: "Bottom" } };
    const rise = await loadRise({ cells: [cell("Alpha", "slide")], metadata: metadata });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    const overlay = $("div.reveal > #rise-overlay");
    const children = Array.from(overlay.children(), (element) => element.id);
    assert.deepEqual(children, ["rise-header", "rise-backimage", "rise-footer"]);
    assert.equal($("#rise-backimage").attr("src"), "back.png");
});

test("the overlay option replaces header, backimage and footer", async (t) => {
    const metadata = { rise: { header: "Top", overlay: "<p id='custom'>Mine</p>" } };
    const rise = await loadRise({ cells: [cell("Alpha", "slide")], metadata: metadata });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");

    assert.equal($("#rise-overlay > #custom").text(), "Mine");
    assert.equal($("#rise-header").length, 0);
});

test("re-entering the slideshow does not add a second set of reveal listeners", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");

    for (const name of ["ready", "slidechanged", "fragmentshown", "fragmenthidden"]) {
        assert.equal(rise.revealListenerCount(name), 1, name);
    }
});

const SLIDE_TYPE_ACTIONS = [
    ["RISE:toggle-slide", "slide"],
    ["RISE:toggle-subslide", "subslide"],
    ["RISE:toggle-fragment", "fragment"],
    ["RISE:toggle-notes", "notes"],
    ["RISE:toggle-skip", "skip"],
];

SLIDE_TYPE_ACTIONS.forEach(([action, slideType]) => {
    test(`${action} sets the selected cell's slide type and a rerun clears it`, async (t) => {
        const cells = [cell("Alpha", undefined), cell("Bravo", undefined)];
        const rise = await loadRise({ cells: cells });
        t.after(rise.close);

        rise.run(action);
        assert.equal(rise.cells[0].metadata.slideshow.slide_type, slideType);
        assert.equal(rise.cells[1].metadata.slideshow, undefined);

        rise.run(action);
        assert.equal(rise.cells[0].metadata.slideshow.slide_type, "");
    });
});

test("edit-all and render-all switch every cell between edit and rendered views", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide"), cell("Bravo", "")] });
    t.after(rise.close);

    rise.run("RISE:edit-all-cells");
    assert.deepEqual(rise.cells.map((c) => c.rendered), [false, false]);

    rise.run("RISE:render-all-cells");
    assert.deepEqual(rise.cells.map((c) => c.rendered), [true, true]);
});

test("the default RISE shortcuts are bound in command mode", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);

    const bindings = rise.shortcutMap("command");
    assert.equal(bindings["alt-r"], "RISE:slideshow");
    assert.equal(bindings["shift-i"], "RISE:toggle-slide");
    assert.equal(bindings["shift-b"], "RISE:toggle-subslide");
    assert.equal(bindings["shift-g"], "RISE:toggle-fragment");
});

test("a custom shortcut replaces its default and an empty one unbinds it", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { shortcuts: { slideshow: "alt-q", "toggle-slide": "" } } },
    });
    t.after(rise.close);

    const bindings = rise.shortcutMap("command");
    assert.equal(bindings["alt-q"], "RISE:slideshow");
    assert.equal(bindings["alt-r"], undefined);
    assert.equal(bindings["shift-i"], undefined);
    assert.equal(bindings[""], undefined);
});

test("inside the slideshow the reveal and plugin actions are bound to their keys", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);

    rise.run("RISE:slideshow");

    const command = rise.shortcutMap("command");
    assert.equal(command["shift-enter"], "RISE:smart-exec");
    assert.equal(rise.shortcutMap("edit")["shift-enter"], "RISE:smart-exec");
    assert.equal(command.home, "RISE:firstSlide");
    assert.equal(command.end, "RISE:lastSlide");
    assert.equal(command.w, "RISE:toggleOverview");
    assert.equal(command.f, "RISE:fullscreenHelp");
    assert.equal(command["shift-/"], "RISE:riseHelp");
    assert.equal(command.t, "RISE:openNotes");
    assert.equal(command["["], "RISE:toggleChalkboard");
    assert.equal(command["shift-f"], "jupyter-notebook:find-and-replace");
});

test("entering and exiting leave reveal's class names in notebook output alone", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    const { $ } = rise;
    const output = $(".cell").first();
    const progressBar = $('<div class="progress"></div>').appendTo(output);
    const hiddenControls = $('<div class="controls"></div>').hide().appendTo(output);

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");
    assert.notEqual(progressBar.css("display"), "none");

    rise.run("RISE:slideshow");
    assert.equal(hiddenControls.css("display"), "none");
});

test("show_buttons_on_startup false hides every RISE button on each entry", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { show_buttons_on_startup: false } },
    });
    t.after(rise.close);
    const { $ } = rise;
    $.fx.off = true;
    // the chalkboard plugin adds these, and they outlive the slideshow
    $('<div id="toggle-chalkboard"></div><div id="toggle-notes"></div>').appendTo("body");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const shown = () => Array.from($("#help_b, #exit_b, #toggle-chalkboard, #toggle-notes"))
        .filter((element) => $(element).css("display") !== "none")
        .map((element) => element.id)
        .sort();

    rise.run("RISE:slideshow");
    assert.deepEqual(shown(), ["exit_b", "help_b", "toggle-chalkboard", "toggle-notes"]);
    t.mock.timers.tick(2000);
    assert.deepEqual(shown(), []);

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");
    t.mock.timers.tick(2000);
    assert.deepEqual(shown(), []);
});

test("exiting clears the skip class from every skip cell", async (t) => {
    const cells = [
        cell("Alpha", "slide"),
        cell("First skip", "skip"),
        cell("Bravo", ""),
        cell("Second skip", "skip"),
        cell("Charlie", "slide"),
        cell("Third skip", "skip"),
    ];
    const rise = await loadRise({ cells: cells });
    t.after(rise.close);
    const { $ } = rise;

    rise.run("RISE:slideshow");
    assert.equal($(".reveal-skip").length, 3);
    rise.run("RISE:slideshow");

    assert.equal($(".reveal-skip").length, 0);
});

test("exiting restores every shortcut the slideshow rebound, custom ones included", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);
    rise.shortcuts.command.set_shortcut("shift-enter", "custom:run");
    rise.shortcuts.edit.set_shortcut("shift-enter", "custom:run");
    const shortcuts = () => {
        return { command: rise.shortcutMap("command"), edit: rise.shortcutMap("edit") };
    };
    const before = shortcuts();

    rise.run("RISE:slideshow");
    rise.run("RISE:slideshow");

    assert.deepEqual(shortcuts(), before);
});

test("exiting restores the shortcuts behind custom reveal keys", async (t) => {
    // "a,b" cannot be bound while "a" is, "g,u" starts with an unbound key, "i" begins "i,i",
    // "f" is bound twice inside the slideshow, by firstSlide and by fullscreenHelp, and nbclassic
    // stores "?" as "/" and "T" as "t"
    const main = { firstSlide: "f", lastSlide: "a,b", toggleOverview: "g,u", riseHelp: "i" };
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: {
            rise: {
                reveal_shortcuts: {
                    main: main,
                    chalkboard: { download: "?" },
                    notes: { openNotes: "T" },
                },
            },
        },
    });
    t.after(rise.close);
    const before = rise.shortcutMap("command");

    rise.run("RISE:slideshow");
    assert.equal(rise.$("#exit_b").length, 1);
    rise.run("RISE:slideshow");

    assert.deepEqual(rise.shortcutMap("command"), before);
    assert.equal(rise.$("#exit_b").length, 0);
});

test("exiting keeps the first cell selected while another slide shows", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide"), cell("Bravo", "slide")] });
    t.after(rise.close);

    rise.run("RISE:slideshow");
    // reveal's ready, which unselects every cell
    await rise.idle(0);
    rise.showSlide(1, 0);
    // k (select-previous-cell) still works inside the slideshow and reaches the hidden cell
    rise.cells[0].select();
    rise.run("RISE:slideshow");

    assert.deepEqual(rise.cells.map((c) => c.selected), [true, false]);
});

// Text of each <kbd> in the help dialog's body.
function helpKeys(dialog) {
    return Array.from(dialog.body.find("kbd"), (element) => element.textContent);
}

test("the help dialog lists the slideshow shortcuts", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);

    rise.run("RISE:riseHelp");

    const [dialog] = rise.dialogs;
    assert.equal(dialog.title, "Reveal Shortcuts Help");
    const keys = helpKeys(dialog);
    for (const key of ["Space", "Shift", "Enter", "home", "end", "w", "t", "/", ",", "["]) {
        assert.ok(keys.includes(key), key);
    }
});

test("the help dialog shows a customized reveal shortcut instead of the default", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { reveal_shortcuts: { main: { firstSlide: "g" } } } },
    });
    t.after(rise.close);

    rise.run("RISE:riseHelp");

    const keys = helpKeys(rise.dialogs[0]);
    assert.ok(keys.includes("g"));
    assert.equal(keys.includes("home"), false);
});

test("every entry in the help dialog has a description", async (t) => {
    const rise = await loadRise({ cells: [cell("Alpha", "slide")] });
    t.after(rise.close);

    rise.run("RISE:riseHelp");

    const items = rise.dialogs[0].body.find("li");
    const entries = Array.from(items, (element) => element.textContent);
    assert.deepEqual(entries.filter((entry) => entry.includes("undefined")), []);
});

test("an empty reveal shortcut leaves its action unbound and still shows the help", async (t) => {
    const rise = await loadRise({
        cells: [cell("Alpha", "slide")],
        metadata: { rise: { reveal_shortcuts: { main: { toggleOverview: "" } } } },
    });
    t.after(rise.close);

    rise.run("RISE:slideshow");
    rise.run("RISE:riseHelp");

    assert.equal(rise.shortcutMap("command")[""], undefined);
    assert.notEqual(rise.shortcutMap("command").w, "RISE:toggleOverview");
    const overview = rise.dialogs[0].body.find("li").filter((index, element) => {
        return element.textContent.includes("overview");
    });
    assert.equal(overview.find("em").text(), "unbound");
});

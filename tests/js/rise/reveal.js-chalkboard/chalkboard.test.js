"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadRevealPlugin } = require("../../harness");

const CHALKBOARD = "reveal.js-chalkboard/chalkboard.js";
const SLIDES = '<section><section id="slide-0-0">Alpha</section></section>';

function loadChalkboard(chalkboard = {}) {
    return loadRevealPlugin(CHALKBOARD, SLIDES, {
        config: { width: 960, height: 700, chalkboard: chalkboard },
    });
}

test("the chalkboard buttons use Font Awesome 4 icons", (t) => {
    const plugin = loadChalkboard();
    t.after(plugin.close);
    const document = plugin.window.document;

    const icon = (selector) => document.querySelector(`${selector} i`).classList;
    assert.ok(icon("#toggle-chalkboard").contains("fa-pencil-square"));
    assert.ok(icon("#toggle-notes").contains("fa-pencil"));
});

test("the toggle button options can remove each chalkboard button", (t) => {
    const plugin = loadChalkboard({ toggleChalkboardButton: false, toggleNotesButton: false });
    t.after(plugin.close);
    const document = plugin.window.document;

    assert.equal(document.querySelector("#toggle-chalkboard"), null);
    assert.equal(document.querySelector("#toggle-notes"), null);
});

test("the board shows a blackboard by default and a whiteboard with that theme", (t) => {
    const blackboard = loadChalkboard();
    const whiteboard = loadChalkboard({ theme: "whiteboard" });
    t.after(() => {
        blackboard.close();
        whiteboard.close();
    });

    const background = (plugin) => {
        return plugin.window.document.getElementById("chalkboard").style.background;
    };
    assert.match(background(blackboard), /img\/blackboard\.png/);
    assert.match(background(whiteboard), /img\/whiteboard\.png/);
});

test("toggling the chalkboard shows and hides the board", (t) => {
    const plugin = loadChalkboard();
    t.after(plugin.close);
    const board = plugin.window.document.getElementById("chalkboard");
    assert.equal(board.style.visibility, "hidden");

    plugin.window.RevealChalkboard.toggleChalkboard();
    assert.equal(board.style.visibility, "visible");

    plugin.window.RevealChalkboard.toggleChalkboard();
    assert.equal(board.style.visibility, "hidden");
});

test("downloaded drawings are sized to the canvases, not reveal's slide size", async (t) => {
    const plugin = loadChalkboard();
    t.after(plugin.close);
    const { innerWidth, innerHeight } = plugin.window;

    plugin.window.RevealChalkboard.download();

    const [blob] = plugin.downloads;
    const storage = JSON.parse(await blob.text());
    assert.equal(storage[1].width, innerWidth);
    assert.equal(storage[1].height, innerHeight);
    assert.notEqual(storage[0].width, 960);
});

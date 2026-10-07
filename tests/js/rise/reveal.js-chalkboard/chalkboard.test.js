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
    const [notes, board] = JSON.parse(await blob.text());
    assert.deepEqual([board.width, board.height], [innerWidth, innerHeight]);
    // the notes canvas covers the slide area, letterboxed to reveal's 960x700 aspect ratio
    assert.equal(notes.width, innerWidth);
    assert.ok(Math.abs(notes.height - (innerWidth * 700) / 960) < 1e-9);
});

function chalkTexturePatches(plugin) {
    let patches = 0;
    const context = new Proxy({ strokeStyle: "rgba(255,255,255,0.5)" }, {
        get(target, name) {
            return name === "clearRect" ? () => (patches += 1) : target[name] ?? (() => {});
        },
        set: (target, name, value) => {
            target[name] = value;
            return true;
        },
    });
    plugin.window.RevealChalkboard.drawWithChalk(context, 0, 0, 200, 0);
    return patches;
}

test("chalkEffect sets how much chalk texture a stroke gets, zero meaning none", (t) => {
    const smooth = loadChalkboard({ chalkEffect: 0 });
    const textured = loadChalkboard({ chalkEffect: 1 });
    t.after(() => {
        smooth.close();
        textured.close();
    });

    assert.equal(chalkTexturePatches(smooth), 0);
    assert.ok(chalkTexturePatches(textured) > 0);
});

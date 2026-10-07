"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadRevealPlugin } = require("../../harness");

const CHALKBOARD = "reveal.js-chalkboard/plugin.js";
const SLIDES = '<section><section id="slide-0-0">Alpha</section></section>';

// RISE's default slide size, which reveal reports as given
function loadChalkboard(chalkboard = {}, context = null) {
    const plugin = loadRevealPlugin(CHALKBOARD, SLIDES, {
        config: { width: "100%", height: "100%", chalkboard: chalkboard },
        context: context,
    });
    plugin.window.RevealChalkboard.init(plugin.deck);
    plugin.deck.emit("ready");
    return plugin;
}

test("downloaded drawings are sized to the canvases, not reveal's slide size", async (t) => {
    const plugin = loadChalkboard();
    t.after(plugin.close);
    const { innerWidth, innerHeight } = plugin.window;

    plugin.window.RevealChalkboard.download();

    const [blob] = plugin.downloads;
    const [notes, board] = JSON.parse(await blob.text());
    assert.deepEqual([notes.width, notes.height], [innerWidth, innerHeight]);
    assert.deepEqual([board.width, board.height], [innerWidth, innerHeight]);
});

// Chalk texture comes from clearRect patches cut into a chalk stroke on the chalkboard.
function chalkTexturePatches(chalkEffect) {
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
    const plugin = loadChalkboard({ chalkEffect: chalkEffect }, context);
    const { window } = plugin;
    window.RevealChalkboard.toggleChalkboard();
    const canvas = window.document.querySelector("#chalkboard canvas");
    const mouse = (type, x) => canvas.dispatchEvent(
        new window.MouseEvent(type, { clientX: x, clientY: 100, bubbles: true }));

    mouse("mousedown", 100);
    patches = 0;
    mouse("mousemove", 300);
    mouse("mouseup", 300);
    plugin.close();
    return patches;
}

test("chalkEffect sets how much chalk texture a stroke gets, zero meaning none", () => {
    assert.equal(chalkTexturePatches(0), 0);
    assert.ok(chalkTexturePatches(1) > 0);
});

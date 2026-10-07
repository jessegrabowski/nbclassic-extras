"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadRevealPlugin } = require("../../../../harness");

const NOTES = "reveal.js/plugin/notes/notes.js";
const QUERY = { query: "?v=20200101" };
const SLIDES = '<section><section id="slide-0-0">Alpha</section></section>';

test("the speaker view opens notes.html beside notes.js, query string and all", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, QUERY);
    t.after(plugin.close);
    plugin.window.RevealNotes.init();

    plugin.window.RevealNotes.open();

    assert.equal(plugin.popups.length, 1);
    const notesHtml = "http://localhost:8888/nbextensions/rise/reveal.js/plugin/notes/notes.html";
    assert.equal(plugin.popups[0].url, notesHtml);
});

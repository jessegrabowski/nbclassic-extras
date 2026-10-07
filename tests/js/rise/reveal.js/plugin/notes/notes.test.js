"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadRevealPlugin } = require("../../../../harness");

const NOTES = "reveal.js/plugin/notes/notes.js";
const QUERY = { query: "?v=20200101" };
const SLIDES = `
<section><section id="slide-0-0">Alpha<aside class="notes">Spoken one</aside>
  <div class="fragment">Bravo<aside class="notes">Spoken fragment</aside></div></section></section>
<section><section id="slide-1-0">Charlie<aside class="notes">Spoken two</aside>
</section></section>`;

function lastState(popup) {
    return popup.messages.filter((message) => message.type === "state").at(-1);
}

test("the speaker view opens notes.html beside notes.js, query string and all", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, QUERY);
    t.after(plugin.close);
    plugin.window.RevealNotes.init();

    plugin.window.RevealNotes.open();

    assert.equal(plugin.popups.length, 1);
    const notesHtml = "http://localhost:8888/nbextensions/rise/reveal.js/plugin/notes/notes.html";
    assert.equal(plugin.popups[0].url, notesHtml);
});

test("opening the speaker view again focuses the open window", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, QUERY);
    t.after(plugin.close);

    plugin.window.RevealNotes.open();
    plugin.window.RevealNotes.open();

    assert.equal(plugin.popups.length, 1);
    assert.equal(plugin.popups[0].focused, 1);
});

test("a blocked speaker view popup tells the presenter", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, { ...QUERY, popupBlocked: true });
    t.after(plugin.close);

    plugin.window.RevealNotes.open();

    assert.equal(plugin.alerts.length, 1);
    assert.match(plugin.alerts[0], /popup/);
});

test("once connected, the speaker view gets the notes of each slide shown", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, QUERY);
    t.after(plugin.close);
    plugin.window.RevealNotes.open();
    const [popup] = plugin.popups;

    plugin.receive({ namespace: "reveal-notes", type: "connected" });
    assert.equal(lastState(popup).notes, "Spoken one");

    plugin.showSlide("#slide-1-0");
    assert.equal(lastState(popup).notes, "Spoken two");
});

test("a fragment's own notes replace the slide's while that fragment is current", (t) => {
    const plugin = loadRevealPlugin(NOTES, SLIDES, QUERY);
    t.after(plugin.close);
    plugin.window.RevealNotes.open();
    const [popup] = plugin.popups;
    plugin.receive({ namespace: "reveal-notes", type: "connected" });

    plugin.window.document.querySelector(".fragment").classList.add("current-fragment");
    plugin.showSlide("#slide-0-0", "fragmentshown");

    assert.equal(lastState(popup).notes, "Spoken fragment");
});

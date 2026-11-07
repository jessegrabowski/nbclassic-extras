"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadMinimap } = require("../harness");

test("loading the extension adds one strip and its stylesheet", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    assert.equal(minimap.$("#minimap").length, 1);
    assert.equal(minimap.$("link[href='./main.css']").length, 1);
});

test("a click centers the notebook on the clicked position", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.mouse("mousedown", 100);

    assert.equal(minimap.scroller.scrollTop, 100 * 8 - 400);
});

test("a click accounts for how far the strip has scrolled", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    minimap.scroller.scrollTop = 7200;

    minimap.mouse("mousedown", 100);

    assert.equal(minimap.scroller.scrollTop, (100 + 200) * 8 - 400);
});

test("a drag moves the viewport marker with the pointer", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    const markerRate = 1 / 8 - 200 / 7200;

    minimap.mouse("mousedown", 100);
    const start = minimap.scroller.scrollTop;
    minimap.mouseOnDocument("mousemove", 150);

    const markerTravel = (minimap.scroller.scrollTop - start) * markerRate;
    assert.ok(Math.abs(markerTravel - 50) < 1e-9);
});

test("a drag ignores how many moves the pointer took", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.mouse("mousedown", 100);
    minimap.mouseOnDocument("mousemove", 150);
    const oneMove = minimap.scroller.scrollTop;
    minimap.mouseOnDocument("mousemove", 120);
    minimap.mouseOnDocument("mousemove", 150);

    assert.equal(minimap.scroller.scrollTop, oneMove);
});

test("grabbing the viewport marker keeps the notebook still until the pointer moves", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    minimap.scroller.scrollTop = 3600;
    const markerRate = 1 / 8 - 200 / 7200;
    const markerTop = 3600 * markerRate;

    minimap.mouse("mousedown", markerTop + 90);
    assert.equal(minimap.scroller.scrollTop, 3600);

    minimap.mouseOnDocument("mousemove", markerTop + 100);
    assert.ok(Math.abs(minimap.scroller.scrollTop - (3600 + 10 / markerRate)) < 1e-6);
});

test("a drag in a notebook that fits the strip moves at the fixed scale", (t) => {
    const minimap = loadMinimap({ scrollHeight: 1000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.mouse("mousedown", 150);
    const start = minimap.scroller.scrollTop;
    minimap.mouseOnDocument("mousemove", 170);

    assert.equal(start, 150 * 8 - 400);
    assert.equal(minimap.scroller.scrollTop - start, 20 * 8);
});

test("a wheel that counts in lines scrolls by whole lines", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.wheel(3, minimap.window.WheelEvent.DOM_DELTA_LINE);

    assert.equal(minimap.scroller.scrollTop, 3 * 16);
});

test("a wheel that counts in pages scrolls by whole pages", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.wheel(2, minimap.window.WheelEvent.DOM_DELTA_PAGE);

    assert.equal(minimap.scroller.scrollTop, 2 * 800);
});

test("only the main button clicks or drags the strip", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    const rightButton = 2;

    minimap.mouse("mousedown", 100, rightButton);
    minimap.mouseOnDocument("mousemove", 200, rightButton);

    assert.equal(minimap.scroller.scrollTop, 0);
});

test("a drag stops at a move with no button held", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.mouse("mousedown", 100);
    const start = minimap.scroller.scrollTop;
    minimap.mouseOnDocument("mousemove", 300, 0);
    minimap.mouseOnDocument("mousemove", 400);

    assert.equal(minimap.scroller.scrollTop, start);
});

test("a drag stops following the pointer when released", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    minimap.mouse("mousedown", 100);
    minimap.mouseOnDocument("mousemove", 200);
    const dragged = minimap.scroller.scrollTop;
    minimap.mouseOnDocument("mouseup", 200);
    minimap.mouseOnDocument("mousemove", 300);

    assert.equal(minimap.scroller.scrollTop, dragged);
});

test("a scroll inside the notebook redraws the strip", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    const output = minimap.$('<div class="output_scroll"></div>');
    output.appendTo(minimap.notebook.container);
    minimap.runFrames();

    output[0].dispatchEvent(new minimap.window.Event("scroll"));

    assert.equal(minimap.runFrames(), 1);
});

test("the stylesheet's arrival tells the page its width changed", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);
    let resizes = 0;
    minimap.window.addEventListener("resize", () => { resizes += 1; });

    minimap.$("link[href='./main.css']")[0].dispatchEvent(new minimap.window.Event("load"));

    assert.equal(resizes, 1);
});

test("the toolbar button toggles the strip and remembers the choice", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800 });
    t.after(minimap.close);

    assert.deepEqual([...minimap.toolbarButtons], ["minimap:toggle-minimap"]);
    assert.equal(minimap.hidden(), false);

    minimap.toggle();
    assert.equal(minimap.hidden(), true);
    assert.equal(minimap.window.localStorage.getItem("minimap.hidden"), "true");

    minimap.toggle();
    assert.equal(minimap.hidden(), false);
    assert.equal(minimap.window.localStorage.getItem("minimap.hidden"), "false");
});

test("a stored choice hides the strip on load", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800, hidden: true });
    t.after(minimap.close);

    assert.equal(minimap.hidden(), true);
});

test("a blocked store leaves the strip on and the button working", (t) => {
    const minimap = loadMinimap({ scrollHeight: 8000, clientHeight: 800, storageBlocked: true });
    t.after(minimap.close);
    t.mock.method(console, "warn", () => {});

    assert.equal(minimap.hidden(), false);

    minimap.toggle();
    assert.equal(minimap.hidden(), true);
});

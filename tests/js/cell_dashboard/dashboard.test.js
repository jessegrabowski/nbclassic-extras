"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadDashboardPage } = require("../harness");

const CHANNEL = "cell_dashboard:work/fit.ipynb";

function pane(outputs, { trusted = true } = {}) {
    return { type: "pane", title: "fit()", outputs: outputs, trusted: trusted };
}

function display(data) {
    return { output_type: "display_data", data: data, metadata: {} };
}

test("the page listens on the channel in its address and announces itself", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    assert.equal(page.channel.name, CHANNEL);
    assert.deepEqual(page.channel.posted, [{ type: "ready" }]);
});

test("a stream shows as text under the cell's title", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);

    page.channel.deliver(pane([{ output_type: "stream", name: "stdout", text: "one\n" }]));

    assert.equal(page.title(), "fit()");
    assert.equal(page.outputs().querySelector("pre").textContent, "one\n");
});

test("a traceback shows as text without its terminal colors", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const traceback = ["\u001b[0;31mValueError\u001b[0m: bad", "line 2"];

    page.channel.deliver(pane([{ output_type: "error", traceback: traceback }]));

    assert.equal(page.outputs().querySelector("pre").textContent, "ValueError: bad\nline 2");
});

for (const [mime, source] of [
    ["image/png", "data:image/png;base64,AAAA"],
    ["image/jpeg", "data:image/jpeg;base64,AAAA"],
    ["image/svg+xml", "data:image/svg+xml,AAAA"],
]) {
    test(`${mime} shows as an image, trusted or not`, (t) => {
        const page = loadDashboardPage({ channelName: CHANNEL });
        t.after(page.close);

        const data = { [mime]: "AAAA", "text/plain": "<Figure>" };
        page.channel.deliver(pane([display(data)], { trusted: false }));

        assert.equal(page.outputs().querySelector("img").getAttribute("src"), source);
    });
}

test("trusted HTML shows as HTML", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "text/html": "<table><tr><td>1</td></tr></table>", "text/plain": "frame" };

    page.channel.deliver(pane([display(data)]));

    assert.equal(page.outputs().querySelector("td").textContent, "1");
});

test("untrusted HTML falls back to its text", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "text/html": "<table><tr><td>1</td></tr></table>", "text/plain": "frame" };

    page.channel.deliver(pane([display(data)], { trusted: false }));

    assert.equal(page.outputs().querySelector("td"), null);
    assert.equal(page.outputs().querySelector("pre").textContent, "frame");
});

test("a JavaScript output falls back to its text", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const data = { "application/javascript": "alert(1)", "text/plain": "<Plot>" };

    page.channel.deliver(pane([display(data)]));

    assert.equal(page.outputs().querySelector("pre").textContent, "<Plot>");
});

test("an output with no type the page can show is left out", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const stream = { output_type: "stream", name: "stdout", text: "one\n" };

    page.channel.deliver(pane([display({ "application/javascript": "alert(1)" }), stream]));

    assert.equal(page.outputs().children.length, 1);
});

test("a new message replaces the pane", (t) => {
    const page = loadDashboardPage({ channelName: CHANNEL });
    t.after(page.close);
    const stream = { output_type: "stream", name: "stdout", text: "one\n" };
    page.channel.deliver(pane([stream, stream]));

    page.channel.deliver(pane([]));

    assert.equal(page.outputs().children.length, 0);
});

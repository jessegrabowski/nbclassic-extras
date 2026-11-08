"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadPaneTree } = require("../harness");

const {
    withNewPane,
    keeping,
    without,
    paneIds,
    moved,
    withRatio,
    withRunEvened,
    clampRatio,
    edgeAt,
} = loadPaneTree();

const WIDE = { width: 1000, height: 600 };
const TALL = { width: 600, height: 1000 };

function row(first, second, ratio = 0.5) {
    return { direction: "row", ratio: ratio, first: first, second: second };
}

function column(first, second, ratio = 0.5) {
    return { direction: "column", ratio: ratio, first: first, second: second };
}

function panes(...ids) {
    return ids.reduce((tree, id) => withNewPane(tree, id, WIDE), null);
}

test("the first pane takes the whole window", () => {
    assert.deepEqual(withNewPane(null, "a", WIDE), { pane: "a" });
});

test("a new pane splits a pane across its longer side", () => {
    assert.deepEqual(withNewPane({ pane: "a" }, "b", WIDE), row({ pane: "a" }, { pane: "b" }));
    assert.deepEqual(withNewPane({ pane: "a" }, "b", TALL), column({ pane: "a" }, { pane: "b" }));
});

test("a named edge overrides the longer side", () => {
    assert.deepEqual(withNewPane({ pane: "a" }, "b", WIDE, "bottom"),
                     column({ pane: "a" }, { pane: "b" }));
});

test("a named edge still splits the largest pane", () => {
    const tree = row({ pane: "a" }, { pane: "b" }, 0.7);

    assert.deepEqual(withNewPane(tree, "c", WIDE, "bottom"),
                     row(column({ pane: "a" }, { pane: "c" }), { pane: "b" }, 0.7));
});

test("a third pane splits the last of two equal panes", () => {
    assert.deepEqual(panes("a", "b", "c"),
                     row({ pane: "a" }, column({ pane: "b" }, { pane: "c" })));
});

test("a fourth pane splits the pane that is still largest", () => {
    assert.deepEqual(panes("a", "b", "c", "d"),
                     row(column({ pane: "a" }, { pane: "d" }),
                         column({ pane: "b" }, { pane: "c" })));
});

test("a resized split changes which pane is largest", () => {
    const tree = column({ pane: "a" }, { pane: "b" }, 0.8);

    assert.deepEqual(withNewPane(tree, "c", WIDE),
                     column(row({ pane: "a" }, { pane: "c" }), { pane: "b" }, 0.8));
});

test("a pane added to a row evens the row into thirds", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }));

    assert.deepEqual(moved(tree, "c", "b", "right"),
                     row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }), 1 / 3));
});

test("a pane added on the near side evens the row the same way", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }));

    assert.deepEqual(moved(tree, "c", "a", "left"),
                     row(row({ pane: "c" }, { pane: "a" }), { pane: "b" }, 2 / 3));
});

test("a fourth pane in a row evens the row into quarters", () => {
    const thirds = row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }), 1 / 3);
    const tree = column(thirds, { pane: "d" });

    assert.deepEqual(moved(tree, "d", "c", "right"),
                     row({ pane: "a" },
                         row({ pane: "b" }, row({ pane: "c" }, { pane: "d" }), 1 / 3),
                         1 / 4));
});

test("a perpendicular split counts as one member of a row", () => {
    const tree = row(column({ pane: "a" }, { pane: "b" }, 0.3), { pane: "c" });
    const added = column(tree, { pane: "d" });

    assert.deepEqual(moved(added, "d", "c", "right"),
                     row(column({ pane: "a" }, { pane: "b" }, 0.3),
                         row({ pane: "c" }, { pane: "d" }),
                         1 / 3));
});

test("a split across a row leaves the row's shares alone", () => {
    const tree = row({ pane: "a" }, { pane: "b" }, 0.7);

    assert.deepEqual(withNewPane(tree, "c", { width: 1000, height: 900 }),
                     row(column({ pane: "a" }, { pane: "c" }), { pane: "b" }, 0.7));
});

for (const [edge, expected] of [
    ["left", row({ pane: "a" }, { pane: "b" })],
    ["right", row({ pane: "b" }, { pane: "a" })],
    ["top", column({ pane: "a" }, { pane: "b" })],
    ["bottom", column({ pane: "b" }, { pane: "a" })],
]) {
    test(`dropping on a pane's ${edge} edge splits that pane there`, () => {
        const tree = row({ pane: "a" }, { pane: "b" });

        assert.deepEqual(moved(tree, "a", "b", edge), expected);
    });
}

test("removing a pane gives its space to its sibling", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }), 0.7);

    assert.deepEqual(without(tree, "b"), row({ pane: "a" }, { pane: "c" }, 0.7));
});

test("keeping some panes closes the gaps of the rest and keeps the shares", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }, 0.3), 0.7);

    assert.deepEqual(keeping(tree, (pane) => pane !== "b"),
                     row({ pane: "a" }, { pane: "c" }, 0.7));
    assert.equal(keeping(tree, () => false), null);
});

test("pane ids come in layout order", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }));

    assert.deepEqual(paneIds(tree), ["a", "b", "c"]);
});

test("removing the last pane empties the layout", () => {
    assert.equal(without({ pane: "a" }, "a"), null);
});

test("moving a pane closes the gap it leaves", () => {
    const tree = row(column({ pane: "a" }, { pane: "b" }, 0.3), { pane: "c" }, 0.7);

    assert.deepEqual(moved(tree, "a", "c", "bottom"),
                     row({ pane: "b" }, column({ pane: "c" }, { pane: "a" }), 0.7));
});

test("a pane dropped on itself stays put", () => {
    const tree = row({ pane: "a" }, { pane: "b" }, 0.3);

    assert.equal(moved(tree, "a", "a", "left"), tree);
});

test("a ratio change reaches the split at the end of the path", () => {
    const tree = row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }));

    assert.deepEqual(withRatio(tree, ["second"], 0.2),
                     row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }, 0.2)));
});

test("a ratio change leaves the original tree alone", () => {
    const tree = row({ pane: "a" }, { pane: "b" });

    withRatio(tree, [], 0.2);

    assert.equal(tree.ratio, 0.5);
});

test("evening a nested divider evens its whole run", () => {
    const tree = row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }, 0.2), 0.7);

    assert.deepEqual(withRunEvened(tree, ["second"], "row"),
                     row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }), 1 / 3));
});

test("evening the outer divider of a run evens the same panes", () => {
    const tree = row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }, 0.2), 0.7);

    assert.deepEqual(withRunEvened(tree, [], "row"),
                     row({ pane: "a" }, row({ pane: "b" }, { pane: "c" }), 1 / 3));
});

test("evening a run leaves splits across it alone", () => {
    const tree = row(column({ pane: "a" }, { pane: "b" }, 0.3), { pane: "c" }, 0.7);

    assert.deepEqual(withRunEvened(tree, [], "row"),
                     row(column({ pane: "a" }, { pane: "b" }, 0.3), { pane: "c" }));
});

test("evening stops at a split across the path", () => {
    const stack = column({ pane: "b" }, { pane: "c" }, 0.2);
    const tree = row({ pane: "a" }, stack, 0.7);

    assert.deepEqual(withRunEvened(tree, ["second"], "column"),
                     row({ pane: "a" }, column({ pane: "b" }, { pane: "c" }), 0.7));
});

test("a ratio stays between a tenth and nine tenths", () => {
    assert.equal(clampRatio(-1), 0.1);
    assert.equal(clampRatio(0.4), 0.4);
    assert.equal(clampRatio(2), 0.9);
});

test("the nearest edge of a box is the one a point is closest to", () => {
    const box = { left: 100, top: 100, width: 200, height: 100 };

    assert.equal(edgeAt({ x: 110, y: 150 }, box), "left");
    assert.equal(edgeAt({ x: 290, y: 150 }, box), "right");
    assert.equal(edgeAt({ x: 200, y: 105 }, box), "top");
    assert.equal(edgeAt({ x: 200, y: 195 }, box), "bottom");
});

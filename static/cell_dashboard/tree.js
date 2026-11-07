/*
 * The cell_dashboard window's layout as a binary tree, kept apart from the page so it needs no DOM.
 * A leaf is {pane: id}. A split is {direction, ratio, first, second}, where direction is 'row' or
 * 'column' and ratio is the share of the space given to first. An empty layout is null. Changes
 * return a new tree and leave their input alone.
 */
window.cellDashboardTree = (function () {
    "use strict";

    const MIN_RATIO = 0.1;
    const MAX_RATIO = 0.9;
    const EDGE_DIRECTIONS = {left: 'row', right: 'row', top: 'column', bottom: 'column'};

    function isLeaf(node) {
        return 'pane' in node;
    }

    function replacing(node, target, replacement) {
        if (isLeaf(node)) {
            return node.pane === target ? replacement : node;
        }
        return {
            ...node,
            first: replacing(node.first, target, replacement),
            second: replacing(node.second, target, replacement),
        };
    }

    // how many panes or perpendicular splits sit side by side along a direction
    function runLength(node, direction) {
        if (isLeaf(node) || node.direction !== direction) {
            return 1;
        }
        return runLength(node.first, direction) + runLength(node.second, direction);
    }

    function isInRun(node, pane, direction) {
        if (isLeaf(node)) {
            return node.pane === pane;
        }
        return node.direction === direction
            && (isInRun(node.first, pane, direction) || isInRun(node.second, pane, direction));
    }

    function evened(node, direction) {
        if (isLeaf(node) || node.direction !== direction) {
            return node;
        }
        return {
            ...node,
            ratio: runLength(node.first, direction) / runLength(node, direction),
            first: evened(node.first, direction),
            second: evened(node.second, direction),
        };
    }

    // splits nest in twos, so three panes in a row would otherwise come out as 1/2, 1/4, 1/4
    function evenedAround(node, pane, direction) {
        if (isLeaf(node)) {
            return node;
        }
        if (isInRun(node, pane, direction)) {
            return evened(node, direction);
        }
        return {
            ...node,
            first: evenedAround(node.first, pane, direction),
            second: evenedAround(node.second, pane, direction),
        };
    }

    function splitAt(tree, target, edge, pane) {
        let isFirst = edge === 'left' || edge === 'top';
        let [first, second] = isFirst ? [{pane}, {pane: target}] : [{pane: target}, {pane}];
        let direction = EDGE_DIRECTIONS[edge];
        let split = {direction, ratio: 0.5, first, second};
        return evenedAround(replacing(tree, target, split), pane, direction);
    }

    function leafSizes(node, width, height) {
        if (isLeaf(node)) {
            return [{pane: node.pane, width, height}];
        }
        let [firstShare, secondShare] = [node.ratio, 1 - node.ratio];
        if (node.direction === 'row') {
            return [
                ...leafSizes(node.first, width * firstShare, height),
                ...leafSizes(node.second, width * secondShare, height),
            ];
        }
        return [
            ...leafSizes(node.first, width, height * firstShare),
            ...leafSizes(node.second, width, height * secondShare),
        ];
    }

    // the largest pane gives up half, across its longer side unless edge names the side. A tie
    // goes to the pane that comes last in the layout, so a third pane leaves the first at half the
    // window.
    function withNewPane(tree, pane, {width, height}, edge = null) {
        if (tree === null) {
            return {pane};
        }
        let largest = leafSizes(tree, width, height).reduce((best, leaf) => {
            return leaf.width * leaf.height >= best.width * best.height ? leaf : best;
        });
        let longerSide = largest.width >= largest.height ? 'right' : 'bottom';
        return splitAt(tree, largest.pane, edge ?? longerSide, pane);
    }

    function without(tree, pane) {
        if (isLeaf(tree)) {
            return tree.pane === pane ? null : tree;
        }
        let first = without(tree.first, pane);
        let second = without(tree.second, pane);
        if (first === null || second === null) {
            return first ?? second;
        }
        return {...tree, first, second};
    }

    function moved(tree, pane, target, edge) {
        return pane === target ? tree : splitAt(without(tree, pane), target, edge, pane);
    }

    // path lists the 'first' and 'second' steps from the root to the split
    function withRatio(tree, path, ratio) {
        if (path.length === 0) {
            return {...tree, ratio};
        }
        let [step, ...rest] = path;
        return {...tree, [step]: withRatio(tree[step], rest, ratio)};
    }

    function reachesAlongRun(node, path, direction) {
        if (node.direction !== direction) {
            return false;
        }
        let [step, ...rest] = path;
        return path.length === 0 || reachesAlongRun(node[step], rest, direction);
    }

    // evens every split in line with the one at the end of path, however they nest
    function withRunEvened(node, path, direction) {
        if (reachesAlongRun(node, path, direction)) {
            return evened(node, direction);
        }
        let [step, ...rest] = path;
        return {...node, [step]: withRunEvened(node[step], rest, direction)};
    }

    function clampRatio(ratio) {
        return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
    }

    function edgeAt({x, y}, {left, top, width, height}) {
        let across = (x - left) / width;
        let down = (y - top) / height;
        let distances = {left: across, right: 1 - across, top: down, bottom: 1 - down};
        return Object.keys(distances).reduce((nearest, edge) => {
            return distances[edge] < distances[nearest] ? edge : nearest;
        });
    }

    return {isLeaf, withNewPane, without, moved, withRatio, withRunEvened, clampRatio, edgeAt};
})();

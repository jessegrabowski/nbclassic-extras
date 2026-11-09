/*
 * The cell_dashboard window: shows the copy of each cell's outputs that the notebook sends it, one
 * pane per cell, arranged by the layout tree in tree.js. The arrangement is kept in the browser's
 * local storage for each notebook, and a reopened window puts returning panes back where they
 * were.
 *
 * The kernel can draw the only plot in a pane again at the size it has there, when the notebook
 * can do that. [r] asks for one redraw and [0] puts back the PNG the cell showed. [oo] makes a pane
 * redraw whenever its size changes, and the choice is kept with the arrangement. A plot that
 * changed since it was shown, or any failure, leaves the PNG the cell showed, and a plot that takes
 * too long to draw is redrawn only on request.
 *
 * [< n/m >], centered in each pane's header, steps through the outputs of the runs of its cell,
 * which the notebook keeps. It stays gray until the cell has run twice. An earlier version shows
 * the PNGs its run drew, since the kernel keeps only the latest run's figures, and the next run
 * brings the pane back to the latest.
 *
 * outputs.js builds what each output shows.
 */
(function () {
    "use strict";

    const PANE_DRAG_TYPE = 'application/x-cell-dashboard-pane';
    const DISCONNECTED_CLASS = 'pane_disconnected';
    const LONGEST_SIDE = 3840;
    const RESIZE_SETTLE_MS = 250;

    const {
        isLeaf,
        withNewPane,
        keeping,
        without,
        paneIds,
        moved,
        withRatio,
        withRunEvened,
        clampRatio,
        edgeAt,
    } = window.cellDashboardTree;
    const {isFigureId, renderOutput} = window.cellDashboardOutputs;
    const channelName = new URLSearchParams(window.location.search).get('channel');
    const channel = new BroadcastChannel(channelName);
    const panes = new Map();
    const root = document.getElementById('panes');
    const layoutKey = `cell_dashboard.layout:${channelName}`;
    const autoKey = `cell_dashboard.auto:${channelName}`;
    let layout = null;
    let draggedPane = null;
    // the panes whose plots draw slowly, which are drawn only on request from then on, even after
    // their cells run again
    const manualPanes = new Set();
    // by figure id, the figures the kernel refused
    const failedFigures = new Set();
    // by image, so a pane sent again asks afresh: the size last asked for, and the drawing its
    // cell made, kept while the image shows a redraw
    const requestedSizes = new WeakMap();
    const cellDrawings = new WeakMap();
    // the panes whose plots are drawn again whenever their size changes. Every other pane keeps
    // the drawing its cell made until asked, since a plot can be expensive to draw.
    const autoPanes = new Set(storedAutoPanes());
    // the arrangement to rebuild as panes return, until a pane outside it arrives or the user
    // rearranges
    let savedLayout = storedLayout();

    function storedLayout() {
        try {
            return JSON.parse(window.localStorage.getItem(layoutKey));
        } catch (error) {
            return null;
        }
    }

    function storedAutoPanes() {
        try {
            let ids = JSON.parse(window.localStorage.getItem(autoKey));
            return Array.isArray(ids) ? ids : [];
        } catch (error) {
            return [];
        }
    }

    function storeAutoPanes() {
        try {
            window.localStorage.setItem(autoKey, JSON.stringify([...autoPanes]));
        } catch (error) {
            console.warn('cell_dashboard: the redraw choice will not outlast this window', error);
        }
    }

    function storeLayout() {
        try {
            window.localStorage.setItem(layoutKey, JSON.stringify(layout));
        } catch (error) {
            console.warn('cell_dashboard: the arrangement will not outlast this window', error);
        }
    }

    // in device pixels, so the drawing is sharp, with the longest side kept in bounds
    function pixelSize(image) {
        let ratio = window.devicePixelRatio || 1;
        let longest = Math.max(image.clientWidth, image.clientHeight) * ratio;
        let shrink = Math.min(1, LONGEST_SIDE / longest);
        return {
            width: Math.round(image.clientWidth * ratio * shrink),
            height: Math.round(image.clientHeight * ratio * shrink),
        };
    }

    // only the one plot in a pane stretches to the room it has, so only such a plot is worth
    // drawing again
    function redrawableImages(within) {
        return [...within.querySelectorAll('.pane_outputs > img:only-of-type[data-figure]')];
    }

    function isRefused(image) {
        return failedFigures.has(image.dataset.figure);
    }

    function figureImages(figure) {
        return [...root.querySelectorAll(`img[data-figure="${figure}"]`)];
    }

    function isAutoPane(pane) {
        return autoPanes.has(pane.dataset.pane);
    }

    function requestRenders(within, {onRequest = false} = {}) {
        for (let image of redrawableImages(within)) {
            let figure = image.dataset.figure;
            let pane = image.closest('.pane');
            let waitsForRequest = manualPanes.has(pane.dataset.pane) || !isAutoPane(pane);
            if (isRefused(image) || (waitsForRequest && !onRequest)) {
                continue;
            }
            let {width, height} = pixelSize(image);
            let size = `${width}x${height}`;
            if (width < 1 || height < 1 || (requestedSizes.get(image) === size && !onRequest)) {
                continue;
            }
            requestedSizes.set(image, size);
            channel.postMessage({type: 'render', figure, width, height});
        }
    }

    // a drawing that arrives after a reset was asked for before it, so it is dropped
    function showRender({figure, png, slow}) {
        if (!isFigureId(figure)) {
            return;
        }
        for (let image of figureImages(figure).filter((image) => requestedSizes.has(image))) {
            if (slow) {
                manualPanes.add(image.closest('.pane').dataset.pane);
            }
            if (!cellDrawings.has(image)) {
                cellDrawings.set(image, image.src);
            }
            image.src = `data:image/png;base64,${png}`;
            showRedrawControls(image.closest('.pane'));
        }
    }

    function resetDrawings(pane) {
        for (let image of redrawableImages(pane)) {
            if (cellDrawings.has(image)) {
                image.src = cellDrawings.get(image);
                cellDrawings.delete(image);
            }
            requestedSizes.delete(image);
        }
        showRedrawControls(pane);
    }

    // a refused figure keeps the drawing it shows and can only be reset
    function showRefusal({figure}) {
        if (!isFigureId(figure)) {
            return;
        }
        failedFigures.add(figure);
        figureImages(figure).forEach((image) => showRedrawControls(image.closest('.pane')));
    }

    // an element loses its scroll position when it leaves the page
    function keepingScroll(elements, change) {
        let positions = elements.map((element) => [element, element.scrollTop, element.scrollLeft]);
        change();
        positions.forEach(([element, top, left]) => {
            element.scrollTop = top;
            element.scrollLeft = left;
        });
    }

    function paneOutputs(pane) {
        return pane.querySelector('.pane_outputs');
    }

    function setRatio(first, second, ratio) {
        first.style.flex = `${ratio} 1 0`;
        second.style.flex = `${1 - ratio} 1 0`;
    }

    function pointerShare(split, direction, {clientX, clientY}) {
        let {left, top, width, height} = split.getBoundingClientRect();
        return direction === 'row' ? (clientX - left) / width : (clientY - top) / height;
    }

    // moves reach the page as often as the pointer, so they restyle the split in place instead of
    // drawing the whole layout again
    function followDivider(divider, direction, path) {
        divider.addEventListener('pointerdown', (start) => {
            start.preventDefault();
            divider.setPointerCapture(start.pointerId);
            let first = divider.previousElementSibling;
            let second = divider.nextElementSibling;
            let follow = (move) => {
                let ratio = clampRatio(pointerShare(divider.parentElement, direction, move));
                layout = withRatio(layout, path, ratio);
                setRatio(first, second, ratio);
            };
            divider.addEventListener('pointermove', follow);
            divider.addEventListener('lostpointercapture', () => {
                divider.removeEventListener('pointermove', follow);
                savedLayout = null;
                storeLayout();
                requestRenders(root);
            }, {once: true});
        });
        divider.addEventListener('dblclick', () => {
            rearrange(withRunEvened(layout, path, direction));
        });
    }

    function elementFor(node, path) {
        if (isLeaf(node)) {
            return panes.get(node.pane);
        }
        let first = elementFor(node.first, [...path, 'first']);
        let second = elementFor(node.second, [...path, 'second']);
        let split = document.createElement('div');
        split.className = `split ${node.direction}`;
        let divider = document.createElement('div');
        divider.className = 'divider';
        setRatio(first, second, node.ratio);
        followDivider(divider, node.direction, path);
        split.append(first, divider, second);
        return split;
    }

    function rearrange(next) {
        savedLayout = null;
        layout = next;
        drawLayout();
    }

    function drawLayout() {
        storeLayout();
        document.getElementById('hint').hidden = layout !== null;
        if (layout === null) {
            root.replaceChildren();
            return;
        }
        // building the layout moves panes off the page, so their positions are read first
        keepingScroll([...panes.values()].map(paneOutputs), () => {
            let whole = elementFor(layout, []);
            // a pane left alone by a close still holds its share of the split it was in
            whole.style.flex = '';
            root.replaceChildren(whole);
        });
        requestRenders(root);
    }

    function edgeUnderPointer({clientX, clientY}, pane) {
        return edgeAt({x: clientX, y: clientY}, pane.getBoundingClientRect());
    }

    // every way a drag can end clears all previews, so none depends on a pane's own dragleave
    function endDrag() {
        draggedPane = null;
        root.querySelectorAll('[data-drop]').forEach((pane) => {
            delete pane.dataset.drop;
        });
    }

    function acceptPaneDrops(pane, id) {
        pane.addEventListener('dragover', (event) => {
            if (draggedPane !== null) {
                event.preventDefault();
                pane.dataset.drop = edgeUnderPointer(event, pane);
            }
        });
        pane.addEventListener('dragleave', () => {
            delete pane.dataset.drop;
        });
        pane.addEventListener('drop', (event) => {
            event.preventDefault();
            let next = moved(layout, draggedPane, id, edgeUnderPointer(event, pane));
            endDrag();
            rearrange(next);
        });
    }

    // the buttons only mean something for a pane holding a plot the kernel can draw again
    function showRedrawControls(pane) {
        let images = redrawableImages(pane);
        let live = images.filter((image) => !isRefused(image));
        let auto = pane.querySelector('.pane_auto');
        auto.hidden = live.length === 0;
        auto.setAttribute('aria-pressed', String(isAutoPane(pane)));
        let waiting = !isAutoPane(pane) || manualPanes.has(pane.dataset.pane);
        pane.querySelector('.pane_redraw').hidden = live.length === 0 || !waiting;
        // a reset only lasts while nothing would draw the plot again on its own
        let resettable = images.some((image) => cellDrawings.has(image)
            && (isRefused(image) || waiting));
        pane.querySelector('.pane_reset').hidden = !resettable;
    }

    function toggleAuto(pane, id) {
        if (autoPanes.has(id)) {
            autoPanes.delete(id);
        } else {
            autoPanes.add(id);
        }
        storeAutoPanes();
        showRedrawControls(pane);
        requestRenders(pane);
    }

    function showVersions(pane, version, versions) {
        let controls = pane.querySelector('.pane_versions');
        controls.classList.toggle('pane_single', versions < 2);
        controls.classList.toggle('pane_past', version < versions);
        // the outputs a cell had when it was sent are its one version until it runs
        let [shown, count] = [Math.max(version, 1), Math.max(versions, 1)];
        controls.querySelector('.pane_version').textContent = `${shown}/${count}`;
        controls.querySelector('.pane_older').disabled = version <= 1;
        controls.querySelector('.pane_newer').disabled = version >= versions;
        pane.dataset.version = version;
    }

    function askForVersion(pane, id, step) {
        channel.postMessage({type: 'version', id, version: Number(pane.dataset.version) + step});
    }

    function versionControls(pane, id) {
        let older = paneButton('[<', 'show the outputs of the run before', () => {
            askForVersion(pane, id, -1);
        });
        older.classList.add('pane_older');
        let newer = paneButton('>]', 'show the outputs of the run after', () => {
            askForVersion(pane, id, 1);
        });
        newer.classList.add('pane_newer');
        let label = document.createElement('span');
        label.className = 'pane_version';
        let controls = document.createElement('span');
        controls.className = 'pane_versions';
        controls.append(older, label, newer);
        return controls;
    }

    function closePane(id) {
        autoPanes.delete(id);
        manualPanes.delete(id);
        storeAutoPanes();
        panes.delete(id);
        rearrange(without(layout, id));
        channel.postMessage({type: 'unlink', id});
    }

    function paneButton(label, help, onClick) {
        let button = document.createElement('button');
        button.className = 'pane_button';
        button.title = help;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    function newPane(id) {
        let pane = document.createElement('section');
        pane.className = 'pane';
        pane.dataset.pane = id;
        // the whole pane is the handle for moving it, which costs its text being selectable
        pane.draggable = true;
        // a link or picture inside HTML output starts a drag of its own, which would carry its
        // address instead of the pane
        pane.addEventListener('dragstart', (event) => {
            if (event.target !== pane) {
                event.preventDefault();
                return;
            }
            draggedPane = id;
            // Firefox starts a drag only if it carries data
            event.dataTransfer.setData(PANE_DRAG_TYPE, id);
        });
        let title = document.createElement('h1');
        title.className = 'pane_title';
        let jump = paneButton('[>]', 'jump to this cell in the notebook', () => {
            channel.postMessage({type: 'jump', id});
        });
        let close = paneButton('[x]', 'close this pane', () => closePane(id));
        let redraw = paneButton('[r]', 'draw this plot again at the pane size', () => {
            requestRenders(pane, {onRequest: true});
        });
        redraw.classList.add('pane_redraw');
        let reset = paneButton('[0]', 'show this plot at the size its cell drew it', () => {
            resetDrawings(pane);
        });
        reset.classList.add('pane_reset');
        let auto = paneButton('[oo]',
                              'turn redrawing whenever the pane size changes on or off',
                              () => toggleAuto(pane, id));
        auto.classList.add('pane_auto');
        let header = document.createElement('header');
        header.className = 'pane_header';
        // the buttons on the right come and go, so they get a column of their own and leave the
        // version controls where they are
        let actions = document.createElement('span');
        actions.className = 'pane_actions';
        actions.append(redraw, reset, auto, jump, close);
        header.append(title, versionControls(pane, id), actions);
        let outputs = document.createElement('div');
        outputs.className = 'pane_outputs';
        pane.append(header, outputs);
        acceptPaneDrops(pane, id);
        return pane;
    }

    function isRestoring(id, edge) {
        return savedLayout !== null && edge === null && paneIds(savedLayout).includes(id);
    }

    function addPane(id, edge) {
        panes.set(id, newPane(id));
        if (isRestoring(id, edge)) {
            layout = keeping(savedLayout, (kept) => panes.has(kept));
        } else {
            savedLayout = null;
            let size = {width: root.clientWidth, height: root.clientHeight};
            layout = withNewPane(layout, id, size, edge);
        }
        drawLayout();
    }

    // a cell deleted from the notebook has no index, so its pane keeps its outputs, marked
    function showIndex(id, index) {
        let pane = panes.get(id);
        if (pane === undefined) {
            return;
        }
        let title = pane.querySelector('.pane_title');
        if (index === null) {
            delete title.dataset.cellIndex;
        } else {
            title.dataset.cellIndex = index;
        }
        pane.classList.toggle(DISCONNECTED_CLASS, index === null);
    }

    // edge only comes with a send that asks for a side, so a refresh or a reload places panes
    // freely
    function showPane({
        id,
        index,
        title,
        outputs,
        trusted,
        edge = null,
        version = 0,
        versions = 0,
    }) {
        if (!panes.has(id)) {
            addPane(id, edge);
        }
        let pane = panes.get(id);
        let redrawable = version === versions;
        pane.querySelector('.pane_title').textContent = title;
        showIndex(id, index);
        showVersions(pane, version, versions);
        paneOutputs(pane).replaceChildren(...outputs.flatMap((output) => {
            return renderOutput(output, {trusted, redrawable});
        }));
        showRedrawControls(pane);
        requestRenders(pane);
    }

    function redrawAfterResizing() {
        let timer = null;
        window.addEventListener('resize', () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => requestRenders(root), RESIZE_SETTLE_MS);
        });
    }

    document.addEventListener('dragend', endDrag);
    channel.onmessage = ({data}) => {
        if (data.type === 'pane') {
            showPane(data);
        } else if (data.type === 'indices') {
            data.indices.forEach(([id, index]) => showIndex(id, index));
        } else if (data.type === 'hello') {
            channel.postMessage({type: 'panes', ids: [...panes.keys()]});
        } else if (data.type === 'rendered') {
            showRender(data);
        } else if (data.type === 'render_failed') {
            showRefusal(data);
        }
    };
    redrawAfterResizing();
    channel.postMessage({type: 'ready'});
})();

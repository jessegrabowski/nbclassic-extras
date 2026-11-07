/*
 * The cell_dashboard window: shows the copy of each cell's outputs that the notebook sends it, one
 * pane per cell, arranged by the layout tree in tree.js. HTML from a notebook that is not trusted
 * shows as text, because this page has no sanitizer. SVG is safe either way, because an image
 * source runs no scripts. HTML that carries a script shows as text too, because scripts inserted
 * into a page do not run, so the plot or widget it builds would be missing.
 */
(function () {
    "use strict";

    // control sequences such as colors and cursor moves, and the hyperlinks some terminals show
    const ANSI_ESCAPE = /\x1b(?:\[[\d;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
    const SCRIPT_TAG = /<script\b/i;
    const PANE_DRAG_TYPE = 'application/x-cell-dashboard-pane';

    const {
        isLeaf,
        withNewPane,
        without,
        moved,
        withRatio,
        withRunEvened,
        clampRatio,
        edgeAt,
    } = window.cellDashboardTree;
    const channelName = new URLSearchParams(window.location.search).get('channel');
    const channel = new BroadcastChannel(channelName);
    const panes = new Map();
    const root = document.getElementById('panes');
    let layout = null;
    let draggedPane = null;

    function imageFrom(source) {
        let image = document.createElement('img');
        image.src = source;
        return image;
    }

    function preformatted(text) {
        let pre = document.createElement('pre');
        pre.textContent = text.replace(ANSI_ESCAPE, '');
        return pre;
    }

    function trustedHtml(markup) {
        let container = document.createElement('div');
        container.innerHTML = markup;
        return container;
    }

    // in nbclassic's order of preference, and the first type an output carries is the one shown
    const RENDERERS = new Map([
        ['text/html', trustedHtml],
        ['image/svg+xml', (svg) => imageFrom(`data:image/svg+xml,${encodeURIComponent(svg)}`)],
        ['image/png', (data) => imageFrom(`data:image/png;base64,${data}`)],
        ['image/jpeg', (data) => imageFrom(`data:image/jpeg;base64,${data}`)],
        ['image/gif', (data) => imageFrom(`data:image/gif;base64,${data}`)],
        ['text/plain', preformatted],
    ]);

    function isShowable(mime, value, trusted) {
        return mime !== 'text/html' || (trusted && !SCRIPT_TAG.test(value));
    }

    function renderData(data, trusted) {
        let type = [...RENDERERS.keys()]
            .find((mime) => mime in data && isShowable(mime, data[mime], trusted));
        return type === undefined ? [] : [RENDERERS.get(type)(data[type])];
    }

    function renderOutput(output, trusted) {
        switch (output.output_type) {
            case 'stream':
                return [preformatted(output.text)];
            case 'error':
                return [preformatted(output.traceback.join('\n'))];
            default:
                return renderData(output.data, trusted);
        }
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
            }, {once: true});
        });
        divider.addEventListener('dblclick', () => {
            layout = withRunEvened(layout, path, direction);
            drawLayout();
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

    function drawLayout() {
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
            layout = moved(layout, draggedPane, id, edgeUnderPointer(event, pane));
            endDrag();
            drawLayout();
        });
    }

    function closePane(id) {
        panes.delete(id);
        layout = without(layout, id);
        drawLayout();
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
        let title = document.createElement('h1');
        title.className = 'pane_title';
        title.draggable = true;
        title.addEventListener('dragstart', (event) => {
            draggedPane = id;
            // Firefox starts a drag only if it carries data
            event.dataTransfer.setData(PANE_DRAG_TYPE, id);
        });
        let jump = paneButton('[>]', 'jump to this cell in the notebook', () => {
            channel.postMessage({type: 'jump', id});
        });
        let close = paneButton('[x]', 'close this pane', () => closePane(id));
        let header = document.createElement('header');
        header.className = 'pane_header';
        header.append(title, jump, close);
        let outputs = document.createElement('div');
        outputs.className = 'pane_outputs';
        pane.append(header, outputs);
        acceptPaneDrops(pane, id);
        return pane;
    }

    function addPane(id, edge) {
        panes.set(id, newPane(id));
        let size = {width: root.clientWidth, height: root.clientHeight};
        layout = withNewPane(layout, id, size, edge);
        drawLayout();
    }

    // a cell deleted from the notebook has no index, so its pane stops showing one
    function showIndex(id, index) {
        let title = panes.get(id)?.querySelector('.pane_title');
        if (title === undefined) {
            return;
        }
        if (index === null) {
            delete title.dataset.cellIndex;
        } else {
            title.dataset.cellIndex = index;
        }
    }

    // edge only comes with a send that asks for a side, so a refresh or a reload places panes
    // freely
    function showPane({id, index, title, outputs, trusted, edge = null}) {
        if (!panes.has(id)) {
            addPane(id, edge);
        }
        let pane = panes.get(id);
        pane.querySelector('.pane_title').textContent = title;
        showIndex(id, index);
        paneOutputs(pane)
            .replaceChildren(...outputs.flatMap((output) => renderOutput(output, trusted)));
    }

    document.addEventListener('dragend', endDrag);
    channel.onmessage = ({data}) => {
        if (data.type === 'pane') {
            showPane(data);
        } else if (data.type === 'indices') {
            data.indices.forEach(([id, index]) => showIndex(id, index));
        }
    };
    channel.postMessage({type: 'ready'});
})();

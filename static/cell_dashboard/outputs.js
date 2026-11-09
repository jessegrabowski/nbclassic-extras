/*
 * The cell_dashboard window's outputs: builds the elements that show one output of a cell, kept
 * apart from the page so a new kind of output only adds a renderer here.
 *
 * HTML from a notebook that is not trusted shows as text, because this page has no sanitizer. SVG
 * is safe either way, because an image source runs no scripts. HTML that carries a script shows as
 * text too, because scripts inserted into a page do not run, so the plot or widget it builds would
 * be missing.
 */
window.cellDashboardOutputs = (function () {
    "use strict";

    // control sequences such as colors and cursor moves, and the hyperlinks some terminals show
    const ANSI_ESCAPE = /\x1b(?:\[[\d;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
    const SCRIPT_TAG = /<script\b/i;
    const METADATA_KEY = 'cell_dashboard';
    const FIGURE_ID = /^[0-9a-f]{32}$/;

    function isFigureId(value) {
        return FIGURE_ID.test(value);
    }

    // an image drags itself by default, and a plot has to move the pane it sits in
    function imageFrom(source) {
        let image = document.createElement('img');
        image.draggable = false;
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

    function withFigureId(elements, metadata) {
        let figure = metadata?.[METADATA_KEY]?.figure;
        if (typeof figure === 'string' && isFigureId(figure)) {
            elements.filter((element) => element.tagName === 'IMG').forEach((image) => {
                image.dataset.figure = figure;
            });
        }
        return elements;
    }

    // redrawable says whether the kernel still holds the figures these outputs name
    function renderOutput(output, {trusted, redrawable}) {
        switch (output.output_type) {
            case 'stream':
                return [preformatted(output.text)];
            case 'error':
                return [preformatted(output.traceback.join('\n'))];
            default: {
                let elements = renderData(output.data, trusted);
                return redrawable ? withFigureId(elements, output.metadata) : elements;
            }
        }
    }

    return {
        isFigureId,
        renderOutput,
    };
})();

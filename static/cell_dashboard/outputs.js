/*
 * The cell_dashboard window's outputs: builds the elements that show one output of a cell, kept
 * apart from the page so a new kind of output only adds a renderer here.
 *
 * HTML from a notebook that is not trusted shows as text, because this page has no sanitizer. SVG
 * is safe either way, because an image source runs no scripts. HTML that carries a script shows as
 * text too, because scripts inserted into a page do not run, so the plot or widget it builds would
 * be missing.
 *
 * A Plotly figure comes out as an empty box holding its spec, which the page draws into once it has
 * plotly.js. The spec is data, so it draws trusted or not. A page that cannot get plotly.js shows
 * the image the output carries beside the spec, if it has one.
 *
 * A renderer whose output takes the pointer itself, such as a plot that zooms on a drag, is wrapped
 * in interactive(). A press inside such an output goes to the output and never moves the pane.
 */
window.cellDashboardOutputs = (function () {
    "use strict";

    // control sequences such as colors and cursor moves, and the hyperlinks some terminals show
    const ANSI_ESCAPE = /\x1b(?:\[[\d;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
    const SCRIPT_TAG = /<script\b/i;
    const METADATA_KEY = 'cell_dashboard';
    const FIGURE_ID = /^[0-9a-f]{32}$/;
    const INTERACTIVE_ATTRIBUTE = 'data-interactive';
    const PLOTLY_MIME = 'application/vnd.plotly.v1+json';
    const PLOTLY_CLASS = 'pane_plotly';
    const IMAGE_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/gif'];
    // by box, a Plotly figure's spec and the data of the output it came in
    const plotlyOutputs = new WeakMap();

    function isFigureId(value) {
        return FIGURE_ID.test(value);
    }

    function interactive(render) {
        return (...values) => {
            let element = render(...values);
            element.setAttribute(INTERACTIVE_ATTRIBUTE, '');
            return element;
        };
    }

    function isInInteractiveOutput(element) {
        return element.closest(`[${INTERACTIVE_ATTRIBUTE}]`) !== null;
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

    function plotlyBox(figure, data) {
        let box = document.createElement('div');
        box.className = PLOTLY_CLASS;
        box.textContent = 'Plotly figure, waiting for plotly.js from the kernel';
        plotlyOutputs.set(box, {figure, data});
        return box;
    }

    function plotlyFigureOf(box) {
        return plotlyOutputs.get(box).figure;
    }

    // the image beside a Plotly figure's spec, or null when its output carries none
    function plotlyStillOf(box) {
        let {data} = plotlyOutputs.get(box);
        let type = IMAGE_TYPES.find((mime) => mime in data);
        return type === undefined ? null : RENDERERS.get(type)(data[type]);
    }

    // in nbclassic's order of preference, and the first type an output carries is the one shown.
    // Plotly's spec comes first, since the HTML beside it needs scripts.
    const RENDERERS = new Map([
        [PLOTLY_MIME, interactive(plotlyBox)],
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
        return type === undefined ? [] : [RENDERERS.get(type)(data[type], data)];
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
        interactive,
        isInInteractiveOutput,
        plotlyFigureOf,
        plotlyStillOf,
        renderOutput,
    };
})();

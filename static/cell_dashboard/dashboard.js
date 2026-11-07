/*
 * The cell_dashboard window: shows the copy of a cell's outputs that the notebook sends it. HTML
 * from a notebook that is not trusted shows as text, because this page has no sanitizer. SVG is
 * safe either way, because an image source runs no scripts.
 */
(function () {
    "use strict";

    const ANSI_ESCAPE = /\x1b\[[\d;]*[A-Za-z]/g;
    const TRUSTED_ONLY = new Set(['text/html']);

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
        ['text/plain', preformatted],
    ]);

    function renderData(data, trusted) {
        let type = [...RENDERERS.keys()]
            .find((mime) => mime in data && (trusted || !TRUSTED_ONLY.has(mime)));
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

    function showPane({title, outputs, trusted}) {
        document.getElementById('pane_title').textContent = title;
        document.getElementById('pane_outputs')
            .replaceChildren(...outputs.flatMap((output) => renderOutput(output, trusted)));
    }

    let channelName = new URLSearchParams(window.location.search).get('channel');
    let channel = new BroadcastChannel(channelName);
    channel.onmessage = ({data}) => {
        if (data.type === 'pane') {
            showPane(data);
        }
    };
    channel.postMessage({type: 'ready'});
})();

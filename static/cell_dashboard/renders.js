/*
 * cell_dashboard's kernel side: loads figures.py into each Python kernel as soon as the kernel is
 * ready, arms a linked cell just before it runs so the figures it shows get ids, and asks the
 * kernel to draw a figure again at the size of the pane showing it. Loading early puts the helper
 * ahead of any cell in the kernel's queue, and until a cell is armed it does nothing. A kernel
 * holding a helper from another version of this file gets this one in its place.
 *
 * Every request is a silent execute, which leaves the execution count and every cell's outputs
 * alone, and the kernel answers through user expressions. Anything missing, whether matplotlib,
 * IPython, or a Python kernel at all, only means no redraw, and panes keep the PNG they have.
 */
define([
    'base/js/namespace',
    'notebook/js/codecell',
    'text!./figures.py',
], function (Jupyter, codecell, helperSource) {
    "use strict";

    const HELPER_MODULE = 'cell_dashboard_figures';
    const HELPER = `__import__('sys').modules[${JSON.stringify(HELPER_MODULE)}]`;
    const INSTALL = `${HELPER}.install()`;
    const FIGURE_ID = /^[0-9a-f]{32}$/;
    const LARGEST_SIDE = 3840;
    // a cell carrying this tag is never armed, so its figures are neither kept nor drawn again
    const NO_REDRAW_TAG = 'dashboard-no-redraw';
    const SLOW_RENDER_SECONDS = 1;

    // a kernel's info reply starts out empty, and the notebook knows its kernelspec's language
    // first
    function isPythonKernel(kernel) {
        let reported = kernel?.info_reply?.language_info?.name;
        return (reported ?? Jupyter.notebook.metadata?.kernelspec?.language) === 'python';
    }

    // resolves to the JSON answer of each named expression, or null for one that failed
    function askKernel(kernel, code, expressions) {
        return new Promise((resolve) => {
            let reply = ({content}) => {
                let results = content.user_expressions ?? {};
                let answers = Object.fromEntries(Object.keys(expressions).map((name) => {
                    let result = results[name];
                    let ok = result?.status === 'ok';
                    return [name, ok ? result.data['application/json'] ?? null : null];
                }));
                resolve(answers);
            };
            kernel.execute(code, {shell: {reply}}, {
                silent: true,
                store_history: false,
                user_expressions: expressions,
            });
        });
    }

    // a fresh namespace keeps the loader's own names out of the user's
    function loaderCode(source) {
        let loader = [
            'import sys, types',
            `source = ${JSON.stringify(source)}`,
            `old = sys.modules.get(${JSON.stringify(HELPER_MODULE)})`,
            "if getattr(old, 'SOURCE', None) != source:",
            "    if hasattr(old, 'uninstall'):",
            '        old.uninstall()',
            `    module = types.ModuleType(${JSON.stringify(HELPER_MODULE)})`,
            '    module.SOURCE = source',
            "    exec(compile(source, 'figures.py', 'exec'), module.__dict__)",
            '    sys.modules[module.__name__] = module',
        ].join('\n');
        return `exec(${JSON.stringify(loader)}, {})`;
    }

    function isRenderRequest({figure, width, height}) {
        let isSide = (side) => Number.isInteger(side) && side >= 1 && side <= LARGEST_SIDE;
        return typeof figure === 'string' && FIGURE_ID.test(figure) && isSide(width)
            && isSide(height);
    }

    /**
     * Start handling figures for the dashboard.
     *
     * @param {function} isLinked - whether a cell id belongs to a linked cell.
     * @param {function} post - sends a message to the dashboard.
     * @returns {object} loadHelper(), which loads figures.py into a Python kernel that lacks it,
     *     request(message), which queues a render the dashboard asked for, and forget(id), which
     *     lets the kernel drop the figures of a cell no pane shows.
     */
    function startRenders(isLinked, post) {
        let loader = loaderCode(helperSource);
        // null until the helper is sent, then the kernel's answer to whether it installed
        let installed = null;
        let pending = new Map();
        let rendering = false;

        // the extension can load after the kernel announced it was ready, so every send tries too
        let loadHelper = () => {
            let kernel = Jupyter.notebook.kernel;
            if (installed !== null || !isPythonKernel(kernel)) {
                return;
            }
            installed = askKernel(kernel, loader, {install: INSTALL})
                .then((answers) => answers.install?.installed === true);
        };

        loadHelper();

        // the kernel runs requests in order, so an arm sent now lands just before the cell. It
        // carries the loader, which does nothing once the helper is there, so arming never depends
        // on when the kernel first became ready.
        let armBeforeRunning = (cell) => {
            let kernel = Jupyter.notebook.kernel;
            let tags = cell.metadata?.tags ?? [];
            let skipped = cell.get_text().trim() === '' || tags.includes(NO_REDRAW_TAG);
            if (!isPythonKernel(kernel) || !isLinked(cell.id) || skipped) {
                return;
            }
            let armed = `${HELPER}.arm(${JSON.stringify(cell.id)})`;
            let answers = askKernel(kernel, loader, {install: INSTALL, armed});
            if (installed === null) {
                installed = answers.then(({install}) => install?.installed === true);
            }
        };

        // one render at a time, and none while the kernel works, so requests cannot pile up behind
        // a long cell
        let renderNext = () => {
            if (rendering || pending.size === 0 || Jupyter.notebook.kernel_busy) {
                return;
            }
            let [[figure, {width, height}]] = pending;
            pending.delete(figure);
            rendering = true;
            let ask = (isReady) => {
                if (!isReady) {
                    return {render: null};
                }
                let render = `${HELPER}.render(${JSON.stringify(figure)}, ${width}, ${height})`;
                return askKernel(Jupyter.notebook.kernel, '', {render});
            };
            Promise.resolve(installed).then(ask).then(({render}) => {
                rendering = false;
                if (render?.png === undefined) {
                    post({type: 'render_failed', figure, error: render?.error ?? 'no answer'});
                } else {
                    let slow = render.seconds > SLOW_RENDER_SECONDS;
                    post({type: 'rendered', figure, png: render.png, slow});
                }
                renderNext();
            });
        };

        // a later size for the same figure replaces one still waiting
        let request = (message) => {
            if (installed !== null && isRenderRequest(message)) {
                let {figure, width, height} = message;
                pending.set(figure, {width, height});
                renderNext();
            }
        };

        let forget = (id) => {
            let ask = (isReady) => {
                if (isReady) {
                    let forgot = `${HELPER}.forget(${JSON.stringify(id)})`;
                    askKernel(Jupyter.notebook.kernel, '', {forgot});
                }
            };
            if (installed !== null) {
                installed.then(ask);
            }
        };

        let execute = codecell.CodeCell.prototype.execute;
        codecell.CodeCell.prototype.execute = function (...args) {
            if (this.kernel) {
                armBeforeRunning(this);
            }
            return execute.apply(this, args);
        };
        Jupyter.notebook.events.on('kernel_idle.Kernel', renderNext);
        // a started or restarted kernel holds no helper, and a render it was running never answers
        Jupyter.notebook.events.on('kernel_ready.Kernel', () => {
            installed = null;
            pending.clear();
            rendering = false;
            loadHelper();
        });

        return {loadHelper, request, forget};
    }

    return {startRenders};
});

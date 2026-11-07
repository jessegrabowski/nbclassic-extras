/*
 * minimap: a strip at the right edge of the notebook that draws its cells at a fixed scale, marks
 * the part on screen, and scrolls the notebook when clicked, dragged, or wheeled. The strip scrolls
 * with the document, so a long notebook stays legible where a scale fitted to the window would not.
 *
 * Positions come from the notebook's real layout, so folded and hidden text takes no space here.
 * Code sits in a frame like its cell and takes its colors from the page's syntax theme.
 * PNG, JPEG, and SVG outputs draw as thumbnails, and preformatted outputs draw as colored text,
 * which covers tracebacks and the tables and progress bars of the rich library. A canvas cannot
 * copy arbitrary page content, so other rich outputs, such as HTML tables and JavaScript plots,
 * draw as gray blocks.
 *
 * A toolbar button hides the strip and gives its column back to the notebook. The choice is kept in
 * this browser's local storage, so a blocked or cleared store leaves the strip on.
 */
define([
    'require',
    'jquery',
    'base/js/namespace',
], function (require, $, Jupyter) {
    "use strict";

    const SCALE = 1 / 8;
    const STRIP_WIDTH = 110;
    const LEFT_PADDING = 6;
    const CONTENT_WIDTH = STRIP_WIDTH - LEFT_PADDING;
    const FRAME_INSET = 3;
    const CHARACTER_WIDTH = 1.1;
    const LINE_HEIGHT = 2;
    const WRAPPED_LINE = /.{1,80}/g;
    const REDRAW_INTERVAL_MS = 150;
    const MAIN_BUTTON = 0;
    const WHEEL_LINE_PIXELS = 16;
    const HIDDEN_CLASS = 'minimap_hidden';
    const HIDDEN_STORAGE_KEY = 'minimap.hidden';

    const HEADING_COLOR = '#3b4a5a';
    const PROSE_COLOR = '#c3cad1';
    const BLOCK_COLOR = '#e1e5e9';
    const VIEWPORT_COLOR = 'rgba(66, 133, 244, 0.15)';

    // theme colors suit thin letters, and at full strength they glare from solid bars this small
    const CODE_OPACITY = 0.5;

    // the column is pure CSS, so editors and plots only learn of it from a window resize, and they
    // listen natively where a jQuery trigger would not reach them
    function announceLayoutChange() {
        window.dispatchEvent(new Event('resize'));
    }

    function loadStylesheet() {
        $('<link/>')
            .attr({rel: 'stylesheet', type: 'text/css', href: require.toUrl('./main.css')})
            .on('load', announceLayoutChange)
            .appendTo('head');
    }

    function scroller() {
        return Jupyter.notebook.scroll_manager.element[0];
    }

    // strip pixels moved per notebook pixel scrolled, so the whole document passes through it
    function stripScrollRate() {
        let {scrollHeight, clientHeight} = scroller();
        let hiddenStrip = Math.max(0, scrollHeight * SCALE - clientHeight);
        return hiddenStrip / Math.max(1, scrollHeight - clientHeight);
    }

    function stripOffset() {
        return scroller().scrollTop * stripScrollRate();
    }

    // the viewport marker's own speed, which is the scale less what the strip takes back by moving
    function markerScrollRate() {
        return SCALE - stripScrollRate();
    }

    function markerTop() {
        return scroller().scrollTop * markerScrollRate();
    }

    function markerHeight() {
        return scroller().clientHeight * SCALE;
    }

    function documentTop(element) {
        let {top} = element.getBoundingClientRect();
        return top - scroller().getBoundingClientRect().top + scroller().scrollTop;
    }

    function isDisplayed(element) {
        return element.getClientRects().length > 0;
    }

    function stripPainter(context, stripHeight, onImageReady) {
        let offset = stripOffset();
        let stripY = (top) => top * SCALE - offset;
        let visible = {top: offset / SCALE, bottom: (offset + stripHeight) / SCALE};

        function clipped(element, width, paint) {
            let top = documentTop(element);
            let {height} = element.getBoundingClientRect();
            let unclipped = visible;
            visible = {
                top: Math.max(unclipped.top, top),
                bottom: Math.min(unclipped.bottom, top + height),
            };
            context.save();
            context.beginPath();
            context.rect(0, stripY(top), width, height * SCALE);
            context.clip();
            paint();
            context.restore();
            visible = unclipped;
        }

        return {
            line(text, top, color, column = 0) {
                context.fillStyle = color;
                for (let word of text.matchAll(/\S+/g)) {
                    context.fillRect(LEFT_PADDING + (column + word.index) * CHARACTER_WIDTH,
                                     stripY(top),
                                     word[0].length * CHARACTER_WIDTH,
                                     LINE_HEIGHT);
                }
            },
            block(element) {
                let {width, height} = element.getBoundingClientRect();
                context.fillStyle = BLOCK_COLOR;
                context.fillRect(LEFT_PADDING,
                                 stripY(documentTop(element)),
                                 Math.min(width * SCALE, CONTENT_WIDTH),
                                 height * SCALE);
            },
            // the page cuts long lines at the editor's edge, so the frame cuts them here
            framed(element, paint) {
                let {width, height} = element.getBoundingClientRect();
                let {backgroundColor, borderTopColor} = getComputedStyle(element);
                let frameLeft = LEFT_PADDING - FRAME_INSET;
                let frameWidth = Math.min(width * SCALE, STRIP_WIDTH) - 2 * FRAME_INSET;
                let frame = [frameLeft, stripY(documentTop(element)), frameWidth, height * SCALE];
                context.fillStyle = backgroundColor;
                context.fillRect(...frame);
                context.strokeStyle = borderTopColor;
                context.strokeRect(...frame);
                clipped(element, frameLeft + frameWidth, paint);
            },
            image(source, element) {
                if (!source.complete) {
                    $(source).off('.minimap').one('load.minimap error.minimap', onImageReady);
                } else if (source.naturalWidth === 0) {
                    this.block(element);
                } else {
                    let {width, height} = element.getBoundingClientRect();
                    let fit = Math.min(SCALE, CONTENT_WIDTH / width);
                    context.drawImage(source,
                                      LEFT_PADDING,
                                      stripY(documentTop(element)),
                                      width * fit,
                                      height * fit);
                }
            },
            // the heights below top that can show, so callers draw only the lines on the strip
            visibleSpan(top) {
                return {start: visible.top - top, end: visible.bottom - top};
            },
            softened(paint) {
                context.globalAlpha = CODE_OPACITY;
                paint();
                context.globalAlpha = 1;
            },
            clippedTo(element, paint) {
                clipped(element, STRIP_WIDTH, paint);
            },
            covers(element) {
                let top = stripY(documentTop(element));
                return top < stripHeight
                    && top + element.getBoundingClientRect().height * SCALE > 0;
            },
        };
    }

    const tokenColors = new Map();

    // a sample span inside the editor picks up its theme's color, and cell types differ in theme
    function tokenColor(type, editor) {
        let key = `${editor.getOption('theme')} ${type}`;
        if (!tokenColors.has(key)) {
            let classes = (type || '').replace(/\S+/g, 'cm-$&');
            let sample = $('<span/>').addClass(classes).appendTo(editor.getWrapperElement());
            tokenColors.set(key, getComputedStyle(sample[0]).color);
            sample.remove();
        }
        return tokenColors.get(key);
    }

    function paintEditorLines(editor, painter) {
        let top = documentTop(editor.getWrapperElement());
        let {start, end} = painter.visibleSpan(top);
        // lineAtHeight answers with the line count for a height below the last line
        let lastLine = Math.min(editor.lineAtHeight(end, 'local'), editor.lastLine());
        for (let line = editor.lineAtHeight(start, 'local'); line <= lastLine; line++) {
            if (editor.getLineHandle(line).height > 0) {
                let lineTop = top + editor.heightAtLine(line, 'local');
                for (let token of editor.getLineTokens(line)) {
                    painter.line(token.string,
                                 lineTop,
                                 tokenColor(token.type, editor),
                                 token.start);
                }
            }
        }
    }

    function paintEditor(editor, painter) {
        let area = editor.getWrapperElement().closest('.input_area');
        painter.framed(area, () => painter.softened(() => paintEditorLines(editor, painter)));
    }

    function evenLines(block, lineCount, painter) {
        let top = documentTop(block);
        let lineHeight = block.getBoundingClientRect().height / Math.max(1, lineCount);
        let {start, end} = painter.visibleSpan(top);
        return {
            lineTop: (index) => top + index * lineHeight,
            first: Math.max(0, Math.floor(start / lineHeight)),
            end: Math.min(lineCount, Math.ceil(end / lineHeight)),
        };
    }

    function paintTextLines(lines, block, painter) {
        let {lineTop, first, end} = evenLines(block, lines.length, painter);
        for (let index = first; index < end; index++) {
            painter.line(lines[index], lineTop(index), PROSE_COLOR);
        }
    }

    function paintStyledRun(text, element, pre, top, column, painter) {
        if (element === pre) {
            painter.line(text, top, PROSE_COLOR, column);
        } else {
            let {color} = getComputedStyle(element);
            painter.softened(() => painter.line(text, top, color, column));
        }
    }

    // text nodes do not follow line breaks, so a line's column has to be counted across its runs
    function paintPreformatted(pre, painter) {
        let lineCount = pre.textContent.trimEnd().split('\n').length;
        let {lineTop, first, end} = evenLines(pre, lineCount, painter);
        let line = 0;
        let column = 0;
        let textNodes = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
        while (line < end && textNodes.nextNode()) {
            let {data, parentElement} = textNodes.currentNode;
            data.split('\n').forEach((run, index) => {
                if (index > 0) {
                    line += 1;
                    column = 0;
                }
                if (line >= first && line < end) {
                    paintStyledRun(run, parentElement, pre, lineTop(line), column, painter);
                }
                column += run.length;
            });
        }
    }

    function paintRenderedBlock(block, painter) {
        let text = block.textContent.trim();
        if (/^H[1-6]$/.test(block.tagName)) {
            painter.line(text, documentTop(block), HEADING_COLOR);
        } else {
            paintTextLines(text.match(WRAPPED_LINE) || [], block, painter);
        }
    }

    const svgImages = new WeakMap();

    function svgImage(svg) {
        if (!svgImages.has(svg)) {
            let image = new Image();
            let markup = new XMLSerializer().serializeToString(svg);
            image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
            svgImages.set(svg, image);
        }
        return svgImages.get(svg);
    }

    function childOfKind(output, kinds, tag) {
        return output.matches(kinds) ? output.querySelector(tag) : null;
    }

    function solePre(output) {
        let only = output.children.length === 1 ? output.children[0] : null;
        return only !== null && only.matches('pre') ? only : null;
    }

    function paintOutput(output, painter) {
        let image = childOfKind(output, '.output_png, .output_jpeg', 'img');
        let svg = childOfKind(output, '.output_svg', 'svg');
        let text = solePre(output);
        if (image !== null) {
            painter.image(image, image);
        } else if (svg !== null) {
            painter.image(svgImage(svg), svg);
        } else if (text !== null) {
            paintPreformatted(text, painter);
        } else {
            painter.block(output);
        }
    }

    function paintCell(cell, painter) {
        if (isDisplayed(cell.code_mirror.getWrapperElement())) {
            paintEditor(cell.code_mirror, painter);
        } else {
            cell.element.find('.text_cell_render').children().toArray()
                .forEach((block) => paintRenderedBlock(block, painter));
        }
        let outputs = cell.element.find('.output')[0];
        if (outputs !== undefined && isDisplayed(outputs)) {
            painter.clippedTo(outputs, () => {
                // rich's live displays use an ipywidgets Output, which nests an output area
                $(outputs).find('.output_subarea:not(:has(.output_subarea))').toArray()
                    .forEach((output) => paintOutput(output, painter));
            });
        }
    }

    function drawStrip(canvas, onImageReady) {
        if (!isDisplayed(canvas)) {
            return;
        }
        let {clientHeight, offsetWidth, clientWidth} = scroller();
        let pixelRatio = window.devicePixelRatio || 1;
        $(canvas).css({
            top: scroller().getBoundingClientRect().top,
            height: clientHeight,
            right: offsetWidth - clientWidth,
        });
        canvas.width = STRIP_WIDTH * pixelRatio;
        canvas.height = clientHeight * pixelRatio;

        let context = canvas.getContext('2d');
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        let painter = stripPainter(context, clientHeight, onImageReady);
        Jupyter.notebook.get_cells()
            .filter((cell) => cell.code_mirror && painter.covers(cell.element[0]))
            .forEach((cell) => paintCell(cell, painter));

        context.fillStyle = VIEWPORT_COLOR;
        context.fillRect(0, markerTop(), STRIP_WIDTH, markerHeight());
    }

    function redrawOnNextFrame(canvas) {
        let pending = false;
        return function redraw() {
            if (!pending) {
                pending = true;
                window.requestAnimationFrame(() => {
                    pending = false;
                    drawStrip(canvas, redraw);
                });
            }
        };
    }

    // CodeMirror's blinking cursor restyles an element twice a second, which changes nothing here
    function isCursorChange({target}) {
        return target.closest('.CodeMirror-cursors') !== null;
    }

    function redrawOnNotebookChanges(redraw) {
        let timer = null;
        new MutationObserver((records) => {
            if (timer === null && !records.every(isCursorChange)) {
                timer = setTimeout(() => {
                    timer = null;
                    redraw();
                }, REDRAW_INTERVAL_MS);
            }
        }).observe(Jupyter.notebook.container[0], {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
    }

    function stripYAt(canvas, clientY) {
        return clientY - canvas.getBoundingClientRect().top;
    }

    function isOnMarker(canvas, clientY) {
        let stripY = stripYAt(canvas, clientY);
        return stripY >= markerTop() && stripY < markerTop() + markerHeight();
    }

    function scrollToStripPosition(canvas, clientY) {
        let documentY = (stripYAt(canvas, clientY) + stripOffset()) / SCALE;
        scroller().scrollTop = documentY - scroller().clientHeight / 2;
    }

    // the strip moves during a drag, so moves count from the drag's start instead of from the strip
    function followDrags(canvas) {
        $(canvas).on('mousedown', (start) => {
            if (start.button !== MAIN_BUTTON) {
                return;
            }
            // a drag that starts here must not select notebook text on its way out of the strip
            start.preventDefault();
            if (!isOnMarker(canvas, start.clientY)) {
                scrollToStripPosition(canvas, start.clientY);
            }
            let startTop = scroller().scrollTop;
            let stopFollowing = () => $(document).off('.minimap');
            $(document).on('mousemove.minimap', (move) => {
                if (move.buttons === 0) {
                    stopFollowing();
                } else {
                    let travel = move.clientY - start.clientY;
                    scroller().scrollTop = startTop + travel / markerScrollRate();
                }
            });
            $(document).one('mouseup.minimap', stopFollowing);
        });
    }

    function pixelsPerWheelUnit(deltaMode) {
        if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
            return WHEEL_LINE_PIXELS;
        }
        return deltaMode === WheelEvent.DOM_DELTA_PAGE ? scroller().clientHeight : 1;
    }

    // the strip sits outside the scroller, so a wheel over it would otherwise scroll nothing
    function forwardWheel(canvas) {
        canvas.addEventListener('wheel', ({deltaY, deltaMode}) => {
            scroller().scrollTop += deltaY * pixelsPerWheelUnit(deltaMode);
        }, {passive: true});
    }

    function storedHidden() {
        try {
            return window.localStorage.getItem(HIDDEN_STORAGE_KEY) === 'true';
        } catch (error) {
            return false;
        }
    }

    function storeHidden(hidden) {
        try {
            window.localStorage.setItem(HIDDEN_STORAGE_KEY, String(hidden));
        } catch (error) {
            console.warn('minimap: the show or hide choice will not outlast this page', error);
        }
    }

    function addToggleButton() {
        let action = Jupyter.keyboard_manager.actions.register({
            help: 'show or hide the minimap',
            icon: 'fa-map-o',
            handler: () => {
                let hidden = $('body').toggleClass(HIDDEN_CLASS).hasClass(HIDDEN_CLASS);
                storeHidden(hidden);
                announceLayoutChange();
            },
        }, 'toggle-minimap', 'minimap');
        Jupyter.toolbar.add_buttons_group([action]);
    }

    function afterNotebookLoads(callback) {
        if (Jupyter.notebook._fully_loaded) {
            callback();
        } else {
            Jupyter.notebook.events.one('notebook_loaded.Notebook', callback);
        }
    }

    function load_jupyter_extension() {
        loadStylesheet();
        let canvas = $('<canvas/>')
            .attr('id', 'minimap')
            .css('width', STRIP_WIDTH)
            .appendTo('body')[0];
        let redraw = redrawOnNextFrame(canvas);
        $('body').toggleClass(HIDDEN_CLASS, storedHidden());
        addToggleButton();
        followDrags(canvas);
        forwardWheel(canvas);
        // capturing also catches the outputs that scroll inside the notebook, whose events do not
        // bubble
        scroller().addEventListener('scroll', redraw, true);
        $(window).on('resize', redraw);
        Jupyter.notebook.events.on('resize-header.Page', redraw);
        redrawOnNotebookChanges(redraw);
        afterNotebookLoads(redraw);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

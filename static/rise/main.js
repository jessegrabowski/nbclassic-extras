/* -*- coding: utf-8; js-indent-level: 2 -*-
 * ----------------------------------------------------------------------------
 * Copyright (c) 2013-2017 Damián Avila and contributors.
 *
 * Distributed under the terms of the Modified BSD License.
 *
 * A Jupyter notebook extension to support *Live* Reveal.js-based slideshows.
 * -----------------------------------------------------------------------------
 */

define([
  'require',
  'jquery',
  'base/js/namespace',
  'base/js/utils',
  'services/config',
  'base/js/keyboard',
], function(require, $, Jupyter, utils, configmod, keyboard) {

  "use strict";

  /*
   * load configuration
   *
   * 1) start from the hardwired settings (in this file)
   * 2) add settings configured in python; these typically can be
   *   2a) either in a legacy file named `livereveal.json`
   *   2b) or, with the official name, in `rise.json`
   * 3) add the settings from nbext_configurator (i.e. .jupyter/nbconfig/notebook.json)
   *    they should all belong in the 'rise' category
   *    the configurator came after the shift from 'livereveal' to 'rise'
   *    so no need to consider 'livereveal' here
   * 4) and finally add the settings from the notebook metadata
   *   4a) for legacy reasons: use the 'livereveal' key
   *   4b) for more consistency, then override with the 'rise' key
   *
   * configLoaded alters the complete_config object in place.
   * it will hold a consolidated set of all relevant settings with their priorities resolved
   *
   * it returns a promise that can be then'ed once the config is loaded
   *
   * setup waits for the config to be loaded before it actually enables keyboard shortcuts
   * and other menu items; so this means that the bulk of the code can assume that the config
   * is already loaded and does not need to worry about using promises, or
   * waiting for any asynchronous code to complete
   */

  let complete_config = {};

  // returns a promise; you can do 'then()' on this promise
  // to do stuff *after* the configuration is completely loaded
  function configLoaded() {

    // see rise.yaml for more details
    let hardwired_config = {

      // behaviour
      start_slideshow_at: 'selected',
      auto_select: 'code',
      auto_select_fragment: true,
      show_buttons_on_startup: true,

      // aspect
      header: undefined,
      footer: undefined,
      backimage: undefined,
      overlay: undefined,

      // timeouts
      // wait for that amont before calling ensure_focused on the
      // selected cell
      restore_timeout: 500,
      // wait for that amount before actually selected auto-selected fragment
      // when going too short, like 250, size of selected cell get odd
      auto_select_timeout: 450,
      // wait for that amount before calling sync() again
      // this is a workaround that fixes #504
      sync_timeout: 250,

      // UI
      toolbar_icon: 'fa-bar-chart',
      shortcuts: {
        'slideshow' : 'alt-r',
        'toggle-slide': 'shift-i',
        'toggle-subslide': 'shift-b',
        'toggle-fragment': 'shift-g',
        // unassigned by default
        'toggle-notes': '',
        'toggle-skip': '',
      },

      // reveal native settings passed as-is
      // see also the 'inherited' variable below in Revealer
      theme: 'simple',
      transition: 'linear',
      // xxx there might be a need to tweak this one when set
      // by the configurator, as e.g. 'false' or 'true' will result
      // in a string and not a boolean
      slideNumber: true,
      width: "100%",
      height: "100%",
      controls: true,
      progress: true,
      history: true,
      scroll: false,
      center: true,
      margin: 0.1,
      minScale: 1.0, // we need this for codemirror to work right
      // turn off reveal's help overlay that is by default bound to question mark / ?
      help: false,

      // plugins
      enable_chalkboard: false,
    };

    // honour the 2 names: 'livereveal' and 'rise'
    // use the ones in livereveal/legacy first
    // so they get overridden if redefined in rise
    let config_section_legacy = new configmod.ConfigSection(
      'livereveal',
      {base_url: utils.get_body_data("baseUrl")});
    // trigger an asynchronous load
    config_section_legacy.load();
    let config_section = new configmod.ConfigSection(
      'rise',
      {base_url: utils.get_body_data("baseUrl")});
    config_section.load();

    // this is also a ConfigSection object as per notebook/static/services/config.js
    let nbext_configurator = Jupyter.notebook.config;
    nbext_configurator.load();

    // nbclassic loads nbextensions before the notebook itself, so the notebook metadata
    // read below is empty until the notebook has finished loading; a notebook that fails to
    // load never resolves this, and RISE then registers neither its actions nor its button
    let notebook_loaded = Jupyter.notebook._fully_loaded
        ? Promise.resolve()
        : new Promise((resolve) => Jupyter.notebook.events.one('notebook_loaded.Notebook', resolve));

    // with Promise.all we can wait for all 3 configs and the notebook to have loaded
    return Promise.all([
      config_section_legacy.loaded,
      config_section.loaded,
      nbext_configurator.loaded,
      notebook_loaded,
    ]).then(
      // and now we can compute the layered config
      function() {
        // 1) initialize with hardwired defaults
        $.extend(true, complete_config, hardwired_config);
        // 2a) and 2b)
        $.extend(true, complete_config, config_section_legacy.data);
        $.extend(true, complete_config, config_section.data);
        // 3)
        $.extend(true, complete_config, nbext_configurator.data.rise);
        // 4a) from the notebook metadata
        let metadata_legacy = Jupyter.notebook.metadata.livereveal;
        $.extend(true, complete_config, metadata_legacy);
        // 4b) ditto
        let metadata = Jupyter.notebook.metadata.rise;
        $.extend(true, complete_config, metadata);
        // console.log("complete_config is OK");
      });
  }

  /*
   * Version of get_cell_elements that will see cell divs at any depth in the HTML tree,
   * allowing container divs, etc to be used without breaking notebook machinery.
   * You'll need to make sure the cells are getting detected in the right order.
   * NOTE: We use the Object prototype to workaround a firefox issue, check the following
   * link to know more about the discussion leading to this use:
   * https://github.com/damianavila/RISE/issues/117#issuecomment-127331816
   */
  Object.getPrototypeOf(Jupyter.notebook).get_cell_elements = function () {
    return this.container.find("div.cell");
  };

  /* uniform way to access slide type, whether the slideshow metadata is set or not
   * also sometimes slide_type is set to '-' by the toolbar
   */
  function get_slide_type(cell) {
    let slide_type = (cell.metadata.slideshow || {}).slide_type;
    return ( (slide_type === undefined) || (slide_type == '-')) ? '' : slide_type;
  }

  function is_slide(cell)    {return get_slide_type(cell) == 'slide';}
  function is_subslide(cell) {return get_slide_type(cell) == 'subslide';}
  function is_fragment(cell) {return get_slide_type(cell) == 'fragment';}
  function is_skip(cell)     {return get_slide_type(cell) == 'skip';}
  function is_notes(cell)    {return get_slide_type(cell) == 'notes';}
  function is_regular(cell)  {return get_slide_type(cell) == '';}

  /* Use the slideshow metadata to rearrange cell DOM elements into the
   * structure expected by reveal.js
   *
   * in the process, each cell receives a 'smart_exec' tag that says
   * how to behave when the cell gets executed with Shift-Enter
   * this tag can be either
   * 'smart_exec_slide' : just do exec, which is what RISE did on all cells at first
   this is for the last cell on a (sub)slide
   i.e. if next cell is slide or subslide
   * 'smart_exec_fragment' : do exec + show next fragment
   if next cell is a fragment
   * 'smart_exec_next' : do the usual exec + select next like in classic notebook
   */
  function markupSlides(container) {
    // Machinery to create slide/subslide <section>s and give them IDs
    let slide_counter = -1, subslide_counter = -1;
    let slide_section, subslide_section;
    function new_slide() {
      slide_counter++;
      subslide_counter = -1;
      return $('<section>').appendTo(container);
    }
    function new_subslide() {
      subslide_counter++;
      return $('<section>').attr('id', 'slide-'+slide_counter+'-'+subslide_counter)
        .appendTo(slide_section);
    }

    // Containers for the first slide.
    slide_section = new_slide();
    subslide_section = new_subslide();
    let current_fragment = subslide_section;

    let selected_cell_idx = Jupyter.notebook.get_selected_index();
    let selected_cell_slide = [0, 0];

    /* Special handling for the first slide: it will work even if the user
     * doesn't start with a 'Slide' cell. But if the user does explicitly
     * start with slide/subslide, we don't want a blank first slide. So we
     * don't create a new slide/subslide until there is visible content on
     * the first slide.
     */
    let content_on_slide1 = false;

    let cells = Jupyter.notebook.get_cells();

    for (let i=0; i < cells.length; i++) {
      let cell = cells[i];
      let slide_type = get_slide_type(cell);

      if (content_on_slide1) {
        if (slide_type === 'slide') {
          // Start new slide
          slide_section = new_slide();
          // In each subslide, we insert cells directly into the
          // <section> until we reach a fragment, when we create a div.
          current_fragment = subslide_section = new_subslide();
        } else if (slide_type === 'subslide') {
          // Start new subslide
          current_fragment = subslide_section = new_subslide();
        } else if (slide_type === 'fragment') {
          // record the <div class='fragment'> element corresponding
          // to each fragment cell in the 'fragment_div' attribute
          cell.fragment_div = current_fragment = $('<div>').addClass('fragment')
            .appendTo(subslide_section);
        }
      } else if (slide_type !== 'notes' && slide_type !== 'skip') {
        // Subsequent cells should be able to start new slides
        content_on_slide1 = true;
      }

      // Record that this slide contains the selected cell
      // this is where we need i as set in the loop over cells
      if (i === selected_cell_idx) {
        selected_cell_slide = [slide_counter, subslide_counter];
      }

      // Move the cell element into the slide <section>
      // N.B. jQuery append takes the element out of the DOM where it was
      if (slide_type === 'notes') {
        // Notes are wrapped in an <aside> element. It goes in the current fragment, not
        // directly in the subslide, so the DOM keeps notebook order: exiting re-appends
        // cells in DOM order, and nbclassic derives its cell list from the DOM.
        current_fragment.append(
          $('<aside>').addClass('notes').append(cell.element)
        );
      } else {
        current_fragment.append(cell.element);
      }

      // Hide skipped cells
      if (slide_type === 'skip') {
        cell.element.addClass('reveal-skip');
      }

    }

    /* set on all cells a smart_exec tag that says how smart exec
     * should behave on that cell
     * the fragment cell also get a smart_exec_next_fragment
     * attribute that points at the <div class='fragment'>
     * corresponding to the (usually immediately) next cell
     * that is a fragment cell
     */
    for (let i=0; i < cells.length; i++) {
      let cell = cells[i];
      // default is 'pinned' because this applies to the last cell
      let tag = 'smart_exec_slide';
      for (let j = i+1; j < cells.length; j++) {
        let next_cell = cells[j];
        let next_type = get_slide_type(next_cell);
        if ((next_type == 'slide') || (next_type) == 'subslide') {
          tag = 'smart_exec_slide';
          break;
        } else if (next_type == 'fragment') {
          tag = 'smart_exec_fragment';
          /* these cells are the last before a fragment
           * and when running smart-exec we'll want to know
           * if that fragment is visible, so we keep a link to
           * the <div class='fragment'> element of that (next)
           * fragment cell
           */
          cell.smart_exec_next_fragment = next_cell.fragment_div;
          break;
        } else if (next_type == '') {
          tag = 'smart_exec_next';
          break;
        }
      }
      cell.smart_exec = tag;
    }

    return selected_cell_slide;
  }

  // a sync still pending at exit would size the notebook container as a slide again
  let pending_sync = null;

  /* Set the #slide-x-y part of the URL to control where the slideshow will start.
   * N.B. We do this instead of using Reveal.slide() after reveal initialises,
   * because that leaves one slide clearly visible on screen for a moment before
   * changing to the one we want. By changing the URL before setting up reveal,
   * the slideshow really starts on the desired slide.
   */
  function setStartingSlide(selected) {

    let start_slideshow = complete_config.start_slideshow_at;
    if (start_slideshow === 'selected') {
      // Start from the selected cell
      Reveal.slide(selected[0], selected[1]);
    } else {
      // Start from the beginning
      Reveal.slide(0, 0);
    }
    setScrollingSlide();
    // warkaround for #504
    // when editing if you swap out of reveal, and then
    // come back in, with 5.6 most of the time display 
    // becomes empty or the contents is way too low
    // this patch makes the situation much better,
    // although it is clearly suboptimal to have 
    // to resort to that sort of dirty patch
    pending_sync = setTimeout(()=>Reveal.sync(), complete_config.sync_timeout);
  }

  /* Setup the scrolling in the current slide if the config option is activated
   *  and the content is greater than 0.95 * slide height
   */
  function setScrollingSlide() {

    let scroll = complete_config.scroll;
    if (scroll === true) {
      let h = $('.reveal').height() * 0.95;
      $('section.present').find('section')
        .filter(function() {
          return $(this).height() > h;
        })
        .css('height', 'calc(95vh)')
        .css('overflow-y', 'scroll')
        .css('margin-top', '20px');
    }
  }

  // the speaker view shows this notebook in iframes whose URL carries a receiver parameter
  function enterSlideshowInSpeakerView() {
    if (/receiver/i.test(window.location.search)) {
      revealMode();
    }
  }

  /* Setup a MutationObserver to call Reveal.sync when an output is generated.
   * This fixes issue #188: https://github.com/damianavila/RISE/issues/188
   */
  let outputObserver = null;
  function setupOutputObserver() {
    function mutationHandler(mutationRecords) {
      mutationRecords.forEach(function(mutation) {
        if (mutation.addedNodes && mutation.addedNodes.length) {
          Reveal.sync();
          setScrollingSlide();
        }
      });
    }

    let $output = $(".output");
    let MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
    outputObserver = new MutationObserver(mutationHandler);

    let observerOptions = { childList: true,
                            characterData: false,
                            attributes: false,
                            subtree: false
                          };
    $output.each(function () {
      outputObserver.observe(this, observerOptions);
    });
  }

  function disconnectOutputObserver() {
    if (outputObserver !== null) {
      outputObserver.disconnect();
    }
  }

  function addHeaderFooterOverlay() {
    let overlay = complete_config.overlay;
    let header =  complete_config.header;
    let footer =  complete_config.footer;
    let backimage =  complete_config.backimage;
    // minimum styling to make these 3 things look
    // like what their name says they should look
    let header_style = "position: absolute; top: 0px;";
    let footer_style = "position: absolute; bottom: 0px;";
    let backimage_style = "width: 100%; height: 100%;";

    let overlay_body = "";
    if (overlay) {
      overlay_body = overlay;
    } else {
      if (header)
        overlay_body += `<div id='rise-header' style='${header_style}'>${header}</div>`;
      if (backimage)
        overlay_body += `<img id='rise-backimage' style='${backimage_style}' src='${backimage}' />`;
      if (footer)
        overlay_body += `<div id='rise-footer' style='${footer_style}'>${footer}</div>`;
    }
    let overlay_div = `<div id='rise-overlay'>${overlay_body}</div>`;
    $('div.reveal').append(overlay_div);
  }

  function removeHeaderFooterOverlay() {
    // it's easier to remove than to hide, plus this way
    // changes in the metadata will be reflected each time
    // we enter reveal again
    $('div#rise-overlay').remove();
  }
   
  // reveal.js loads as an AMD module on the first entry, which also initializes it; later entries
  // reconfigure the same deck
  let Reveal = null;
  let reveal_initialized = false;

  // listeners RISE adds to reveal, removed on exit so re-entering does not stack a second set
  let reveal_listeners = [];

  function addRevealListener(name, handler) {
    Reveal.addEventListener(name, handler);
    reveal_listeners.push([name, handler]);
  }

  function removeRevealListeners() {
    for (let [name, handler] of reveal_listeners) {
      Reveal.removeEventListener(name, handler);
    }
    reveal_listeners = [];
  }

  const RISE_BUTTONS = '#help_b,#exit_b,#toggle-chalkboard,#toggle-notes';

  // the controls reveal creates directly inside its root element, div#notebook; notebook
  // output can carry the same class names (a Bootstrap .progress bar, say)
  function revealChrome() {
    return $('div#notebook')
      .children('.backgrounds, .progress, .controls, .slide-number, .speaker-notes, .pause-overlay')
      .add('div#aria-status-div');
  }

  function toggleAllRiseButtons() {
    $(RISE_BUTTONS).fadeToggle()
  }

  function chalkboard() {
    return Reveal.getPlugin('RevealChalkboard');
  }

  // RISE binds the chalkboard actions as Jupyter shortcuts, so the plugin's own keys stay off
  const CHALKBOARD_KEYS_OFF = {
    toggleNotesCanvas: false, toggleChalkboard: false, clear: false, reset: false,
    resetAll: false, colorNext: false, colorPrev: false, download: false,
  };

  // `placement` is the chalkboard's toggleChalkboardButton or toggleNotesButton setting: false
  // leaves the button out, an object may set its left, bottom, top and right
  function addChalkboardButton(id, icon, handler, placement, default_left) {
    if (placement === false || $(`#${id}`).length) {
      return;
    }
    let position = (typeof placement === 'object') ? placement : {};
    $(`<div class="chalkboard-button" id="${id}"><a href="#"><i class="fa ${icon}"></i></a></div>`)
      .css({
        position: 'absolute',
        zIndex: 30,
        fontSize: '24px',
        left: position.left || default_left,
        bottom: position.bottom || '30px',
        top: position.top || 'auto',
        right: position.right || 'auto',
      })
      .on('click', (event) => {
        event.preventDefault();
        handler();
      })
      .appendTo('div.reveal');
  }

  function addChalkboardButtons() {
    let config = complete_config.chalkboard || {};
    addChalkboardButton('toggle-chalkboard', 'fa-pencil-square',
                        () => chalkboard().toggleChalkboard(), config.toggleChalkboardButton,
                        '30px');
    addChalkboardButton('toggle-notes', 'fa-pencil',
                        () => chalkboard().toggleNotesCanvas(), config.toggleNotesButton, '70px');
  }
  
  function Revealer(selected_slide) {
    
    // console.log(`complete_config: ${JSON.stringify(complete_config)}`);
    
    $('body').addClass("rise-enabled");
    // Prepare the DOM to start the slideshow
    $('div#header').hide();
    $('.end_space').hide();

    // Add the main reveal.js classes
    $('div#notebook').addClass("reveal");
    $('div#notebook-container').addClass("slides");

    // Header
    // Available themes are in reveal.js/theme
    let theme = complete_config.theme;
    $('body').addClass(`theme-${theme}`);
    let theme_path = `./reveal.js/theme/${theme}.css`;
    $('head').prepend(
      `<link rel="stylesheet" href="${require.toUrl(theme_path)}" id="theme" />`);
    // Add reveal css
    let main_path = "./reveal.js/reveal.css";
    $('head').prepend(
      `<link rel="stylesheet" href="${require.toUrl(main_path)}" id="revealcss" />`);

    /* this policy of trying ./rise.css and then <notebook>.css
     * should be redefinable in the config
     */
    // https://github.com/damianavila/RISE/issues/509
    let name = Jupyter.notebook.notebook_name;
    // remove extension if any
    let dot_index = name.lastIndexOf('.');
    let stem = (dot_index == -1) ? name : name.substr(0, dot_index);
    // associated css
    let name_css = `${stem}.css`;
    // Attempt to load rise.css
    $('head').append(
      `<link rel="stylesheet" href="rise.css" id="rise-custom-css" />`);
    // Attempt to load css with the same path as notebook
    $('head').append(
      `<link rel="stylesheet" href="${name_css}" id="rise-notebook-css" />`);


    let enable_chalkboard = complete_config.enable_chalkboard;
    let modules = ['./reveal.js/reveal.js', './reveal.js/plugin/notes.js'];
    if (enable_chalkboard) {
      // chalkboard is a plain script that defines window.RevealChalkboard
      modules.push('./reveal.js-chalkboard/plugin.js');
      let chalkboard_css_path = './reveal.js-chalkboard/style.css';
      $('head').append(
        `<link rel="stylesheet" href="${require.toUrl(chalkboard_css_path)}" id="chalkboardcss" />`);
    }

    require(modules.map(require.toUrl), function(reveal, RevealNotes) {
      Reveal = reveal;
      // Full list of configuration options available here:
      // https://revealjs.com/config/

      // all these settings are passed along to reveal as-is
      // xxx it might be just better to copy the whole complete_config instead
      // of selecting some names, which would allow users to transparently use
      // all reveal's features
      let inherited = ['controls', 'progress', 'history', 'width', 'height', 'margin',
                       'minScale', 'transition', 'slideNumber', 'center', 'help'];

      let options = {

        // turn off reveal native help
        help: false,

        // the URL hash names only the slide, and the deck never switches to reveal's scroll
        // view in a narrow window
        fragmentInURL: false,
        scrollActivationWidth: null,

        // key bindings configurable are now defined in the reveal_default_bindings dict -
        // this should only be used to unbind keys
        // note that toggleAllRiseButtons is bound to comma here as jupyter does not
        // allow to bind anything to comma!
        keyboard: {
          13: null, // Enter disabled
          27: null, // ESC disabled
          35: null, // End - last slide disabled (will be set in custom keys)
          36: null, // Home - first slide disabled (will be set in custom keys)
          38: null, // up arrow disabled
          40: null, // down arrow disabled
          66: null, // b, black pause disabled, use period or forward slash
          70: null, // disable fullscreen inside the slideshow, makes codemirror unreliable
          71: null, // g, jump to slide disabled
          72: null, // h, left disabled
          74: null, // j, down disabled
          75: null, // k, up disabled
          76: null, // l, right disabled
          78: null, // n, down disabled
          79: null, // o disabled
          80: null, // p, up disabled
          83: null, // s, the notes plugin's speaker view key; RISE opens it with t
          87: null, // w, toggle overview
          188: toggleAllRiseButtons, // comma
        },

        plugins: [RevealNotes],
      };

      for (let setting of inherited) {
        options[setting] = complete_config[setting];
      }

      if (enable_chalkboard) {
        options.chalkboard = $.extend(
          true, {}, complete_config.chalkboard, {keyBindings: CHALKBOARD_KEYS_OFF});
        options.plugins.push(window.RevealChalkboard);
      }

      let started;
      if (reveal_initialized) {
        // the previous exit hid these inline; reveal sets the display of the ones it
        // manages again when configured, the others would stay hidden
        revealChrome().css('display', '');
        // chalkboard buttons outlive the slideshow, so start each entry from shown
        $('#toggle-chalkboard, #toggle-notes').show();
        Reveal.configure(options);
        started = Promise.resolve();
      } else {
        started = Reveal.initialize(options);
        reveal_initialized = true;
      }

      addRevealListener('ready', function(event) {
        Unselecter();
        // check and set the scrolling slide when you start the whole thing
        setScrollingSlide();
        autoSelectHook();
      });

      addRevealListener('slidechanged', function(event) {
        Unselecter();
        // check and set the scrolling slide every time the slide change
        setScrollingSlide();
        autoSelectHook();
      });

      addRevealListener('fragmentshown', function(event) {
        autoSelectHook();
      });
      addRevealListener('fragmenthidden', function(event) {
        autoSelectHook();
      });

      // Sync when an output is generated.
      setupOutputObserver();
      addHeaderFooterOverlay();

      started.then(function() {
        // the slideshow may have been exited before reveal finished starting
        if (!$('body').hasClass('rise-enabled')) {
          Reveal.removeEventListeners();
          return;
        }
        setStartingSlide(selected_slide);
        if (enable_chalkboard) {
          addChalkboardButtons();
        }
      });

      if (! complete_config.show_buttons_on_startup) {
        /* safer, and nicer too, to wait for reveal extensions to start */
        setTimeout(() => $(RISE_BUTTONS).fadeOut(), 2000);
      }
    });
  }

  function Unselecter(){
    let cells = Jupyter.notebook.get_cells();
    for (let cell of cells){
      cell.unselect();
    }
  }

  function fixCellHeight(){
    // Let's start with all the cell unselected, the unselect the current selected one
    let scell = Jupyter.notebook.get_selected_cell();
    scell.unselect();
    // This select/unselect code cell triggers the "correct" heigth in the codemirror instance
    let cells = Jupyter.notebook.get_cells();
    for (let cell of cells){
      if (cell.cell_type === "code") {
        cell.select();
        cell.unselect();
      }
    }
  }

  /* from notebook/actions.js
   * jupyter-notebook:run-cell -> notebook.execute_selected_cells()
   * jupyter-notebook:run-cell-and-select-next -> notebook.execute_cell_and_select_below()
   */
  function smartExec() {
    // is it really the selected cell that matters ?
    let smart_exec = Jupyter.notebook.get_selected_cell().smart_exec;
    if (smart_exec == 'smart_exec_slide') {
      Jupyter.notebook.execute_selected_cells();
    } else if (smart_exec == "smart_exec_fragment") {
      // let's see if the next fragment is visible or not
      let cell = Jupyter.notebook.get_selected_cell();
      let fragment_div = cell.smart_exec_next_fragment;
      let visible = $(fragment_div).hasClass('visible');
      if (visible) {
        Jupyter.notebook.execute_cell_and_select_below();
      } else {
        Jupyter.notebook.execute_selected_cells();
      }
    } else {
      Jupyter.notebook.execute_cell_and_select_below();
    }
  }
  
  // action for reveal.js and reveal.js plug-in bindings
  // this a the dictionary structure as generated by nbextension_configurator 
  // with the corresponding API calls to RISE/reveal.js and/or its plug-ins 
  let reveal_actions = {
      'main': {   // RISE/reveal.js API calls
        'firstSlide': () => Reveal.slide(0), // jump to first slide
        'lastSlide': () => Reveal.slide( Number.MAX_VALUE ),  // jump to last slide
        'toggleOverview': () => Reveal.toggleOverview(),  // toggle overview
        'toggleAllRiseButtons': toggleAllRiseButtons,  // show/hide buttons
        'fullscreenHelp': fullscreenHelp,  // show fullscreen help
        'riseHelp': riseHelp,  // '?' show our help
      },
      'chalkboard': { // API calls for RevealChalkboard plug-in
        'clear': () => chalkboard().clear(), // clear full size chalkboard
        'reset': () => chalkboard().reset(), // reset chalkboard data on current slide
        'toggleChalkboard': () => chalkboard().toggleChalkboard(),  // toggle full size chalkboard
        'toggleNotesCanvas': () => chalkboard().toggleNotesCanvas(), // toggle notes (slide-local)
        'colorNext': () => chalkboard().colorNext(), // next color
        'colorPrev': () => chalkboard().colorPrev(), // previous color
        'download': () => chalkboard().download()  //  download recorded chalkboard drawing
      },
      'notes': { // API calls for RevealNotes plug-in
          'openNotes' : () => Reveal.getPlugin('notes').open(), // open speaker notes window
      },
  }
  
  let reveal_helpstr = {
      'main': {   // RISE/reveal.js API calls
        'firstSlide': 'jump to first slide',
        'lastSlide': 'jump to last slide',
        'toggleOverview': 'toggle overview',
        'toggleAllRiseButtons': 'show/hide buttons',
        'fullscreenHelp': 'show fullscreen help',
        'riseHelp': 'show this help dialog'
      },
      'chalkboard': { // API calls for RevealChalkboard plug-in
        'clear': 'clear full size chalkboard',
        'reset': 'reset chalkboard data on current slide',
        'toggleChalkboard': 'toggle full size chalkboard',
        'toggleNotesCanvas': 'toggle notes (slide-local)',
        'colorNext': 'cycle to next pen color',
        'colorPrev': 'cycle to previous pen color',
        'download': 'download recorded chalkboard drawing'
      },
      'notes': { // API calls for RevealNotes plug-in
          'openNotes' : 'open speaker notes window'
      },
  }
  
  // need to check, if we can fetch the default bindings from rise.yaml (nbconfig)
  let reveal_default_bindings = {
      'main': {
        'firstSlide': 'home',
        'lastSlide': 'end',             // keycode 35
        'toggleOverview': 'w',          // keycode 87
        //'toggleAllRiseButtons': 'm',  // keycode 188 (",") is not allowed in jupyter! using m instead
        'fullscreenHelp': 'f',          // keycode 70
        'riseHelp': 'shift-/',          // what nbclassic calls the ? key
      },
      'chalkboard': {
        'clear': 'minus',               // keycode 189 (and 173 on firefox)
        'reset': '=',                   // keycode 187 (and 61 on firefox)
        'toggleChalkboard': '[',        // keycode 219
        'toggleNotesCanvas': ']',       // keycode 221
        'colorPrev': 'q',               // keycode 81
        'colorNext': 's',               // kecode 83
        'download': '\\'                // keycode 220
      },
      'notes': { // API calls for RevealNotes plug-in
          'openNotes' : 't'             // keycode 84
      },
  }
  
  // update reveal bindings with custom key codes
  function updateRevealBindings(default_bindings){
    
    // console.log(`complete_config in updateRevealBindings`, complete_config);
    let custom_shortcuts = complete_config.reveal_shortcuts;
    // console.log(`custom_shortcuts in updateRevealBindings`, custom_shortcuts);
    
    if (custom_shortcuts) {
      for (const module of Object.keys(custom_shortcuts)){
        for (const action of Object.keys(custom_shortcuts[module])){
           default_bindings[module][action] = custom_shortcuts[module][action];
        }
      }
    }
    return default_bindings;
  }
  

  // [shortcut manager, key, previous action] for every binding the slideshow changed
  let replaced_shortcuts = [];

  // nbclassic's get_shortcut throws when a multi-key shortcut starts with an unbound key
  function currentBinding(manager, key) {
    let keys = key.split(',');
    for (let length = 1; length < keys.length; length++) {
      if (manager.get_shortcut(keys.slice(0, length).join(',')) === undefined) {
        return undefined;
      }
    }
    return manager.get_shortcut(key);
  }

  // nbclassic stores and removes shortcuts in normalized form, and refuses a multi-key shortcut
  // whose first key is already bound on its own; only bindings it accepted are undone on exit
  function rebind(manager, key, action) {
    key = keyboard.normalize_shortcut(key);
    let previous = currentBinding(manager, key);
    if (manager.set_shortcut(key, action)) {
      replaced_shortcuts.push([manager, key, previous]);
    }
  }

  function restoreShortcutTree(manager, prefix, tree) {
    for (let [key, node] of Object.entries(tree)) {
      if (typeof node === 'string') {
        manager.set_shortcut(`${prefix},${key}`, node);
      } else {
        restoreShortcutTree(manager, `${prefix},${key}`, node);
      }
    }
  }

  function setupKeys(mode){

    let command_shortcuts = Jupyter.keyboard_manager.command_shortcuts;
    let edit_shortcuts = Jupyter.keyboard_manager.edit_shortcuts;

    if (mode === 'reveal_mode') {
      let reveal_bindings = updateRevealBindings(reveal_default_bindings);
      rebind(command_shortcuts, "shift-enter", "RISE:smart-exec");
      rebind(edit_shortcuts, "shift-enter", "RISE:smart-exec");
      // add all reveal.js and plugin bindings to jupyter
      for (const module of Object.keys(reveal_bindings)){
        for (const action of Object.keys(reveal_bindings[module])){
          const key = reveal_bindings[module][action];
          if (key) {
            rebind(command_shortcuts, key, `RISE:${action}`);
          }
        }
      }
      // f opens the fullscreen help inside the slideshow, see also #375
      rebind(command_shortcuts, "shift-f", "jupyter-notebook:find-and-replace");
    } else if (mode === 'notebook_mode') {
      // undo in reverse order, so a key changed twice ends with its original action
      for (let [manager, key, previous] of replaced_shortcuts.reverse()) {
        if (typeof previous === 'string') {
          manager.set_shortcut(key, previous);
        } else if (previous !== undefined) {
          // key began multi-key shortcuts (like 'i' in 'i,i'), which the binding replaced
          manager.remove_shortcut(key);
          restoreShortcutTree(manager, key, previous);
        } else if (currentBinding(manager, key) !== undefined) {
          manager.remove_shortcut(key);
        }
      }
      replaced_shortcuts = [];
    }
  }

  /*
   * Renders a shortcut (keys separated by commas) as <kbd> elements, or marks it
   * unbound when it is empty.
   */
  function shortcutRepr(shortcuts){
    
    let key_str = "";
    let first_entry = true;
    
    if (shortcuts.length > 0){
      for (const key of shortcuts.split(",")){
        if (!first_entry){
          key_str += ",<kbd>" + key + "</kbd>";
          
        } else {
          key_str += "<kbd>" + key + "</kbd>";
          first_entry = false;
        }
      }
    } else {
      key_str += "<em>unbound</em>";
    }
    return key_str;
  }

  
  /*
   * Creates a list item string for help dialog
   * 
   * Args:
   * shortcut_str = string representation of keyboard shortcut(s)
   * help_str = help text to be shown for item
   */
  function helpListItem(shortcut_str, help_str){
    return `<li>${shortcutRepr(shortcut_str)} : ${help_str}</li>`;
  }
  
  function riseHelp() {
    let jupyter_keys;
    let reveal_keys;
    let cb_keys;
    let no_keys;
    
    //check if custom bindings for registered jupyter calls are defined
    if (typeof complete_config.shortcuts !== 'undefined'){
      jupyter_keys = complete_config.shortcuts;
    }
    else{
      jupyter_keys = {};
    }

    let updated_keybindings = updateRevealBindings(reveal_default_bindings);
    
    //console.log(`updated bindings: ${JSON.stringify(updated_keybindings)}`);
    
    reveal_keys = updated_keybindings['main'];
    cb_keys = updated_keybindings['chalkboard'];
    no_keys = updated_keybindings['notes'];
    let reveal_help = reveal_helpstr['main'];
    let cb_help = reveal_helpstr['chalkboard'];
    let no_help= reveal_helpstr['notes'];
    
    let message = $('<div/>').append(
      $("<p/></p>").addClass('dialog').html(
        "<ul>" +
          helpListItem(reveal_keys.riseHelp, reveal_help.riseHelp) +
          "<li><kbd>Alt</kbd>+<kbd>r</kbd>: enter/exit RISE</li>" +
          "<li><kbd>Space</kbd>: next</li>" +
          "<li><kbd>Shift</kbd>+<kbd>Space</kbd>: previous</li>" +
          "<li><kbd>Shift</kbd>+<kbd>Enter</kbd>: eval and select next cell if visible</li>" +
          helpListItem(reveal_keys.firstSlide, reveal_help.firstSlide) +
          helpListItem(reveal_keys.lastSlide, reveal_help.lastSlide) +
          helpListItem(reveal_keys.toggleOverview, reveal_help.toggleOverview) +
          helpListItem(no_keys.openNotes, no_help.openNotes) +
          `<li><kbd>,</kbd>: ${reveal_help.toggleAllRiseButtons}</li>` +
          "<li><kbd>/</kbd>: black screen</li>" +
          "<li><strong>less useful:</strong>" +
          "<ul>" +
          "<li><kbd>PgUp</kbd>: up</li>" +
          "<li><kbd>PgDn</kbd>: down</li>" +
          "<li><kbd>Left Arrow</kbd>: left <em>(note: Space preferred)</em></li>" +
          "<li><kbd>Right Arrow</kbd>: right <em>(note: Shift Space preferred)</em></li>" +
          "</ul>" +
          "<li><strong>with chalkboard enabled:</strong>" +
          "<ul>" +
          helpListItem(cb_keys.toggleChalkboard, cb_help.toggleChalkboard) +
          helpListItem(cb_keys.toggleNotesCanvas, cb_help.toggleNotesCanvas) +
          helpListItem(cb_keys.colorNext, cb_help.colorNext) +
          helpListItem(cb_keys.colorPrev, cb_help.colorPrev) +
          helpListItem(cb_keys.download, cb_help.download) +
          helpListItem(cb_keys.reset, cb_help.reset) +
          helpListItem(cb_keys.clear, cb_help.clear) +
          "</ul>" +
          "</ul>" +
          "<b>NOTE</b>: of course you have to use these shortcuts <b>in command mode.</b>"
      )
    );

    Jupyter.dialog.modal({
      title : "Reveal Shortcuts Help",
      body : message,
      buttons : {
        OK : {class: "btn-danger"}
      }
    });
  }

  function buttonHelp() {
    let help_button = $('<i/>')
        .attr('id','help_b')
        .attr('title','Reveal Shortcuts Help')
        .addClass('fa-question fa-4x fa')
        .addClass('my-main-tool-bar')
        .click(riseHelp);
    $('.reveal').after(help_button);
  }

  function buttonExit() {
    let exit_button = $('<i/>')
        .attr('id','exit_b')
        .attr('title','Exit RISE')
        .addClass('fa-times-circle fa-4x fa')
        .addClass('my-main-tool-bar')
        .click(revealMode);
    $('.reveal').after(exit_button);
  }

  function fullscreenHelp() {
    let message = $('<div/>').append(
      $("<p/></p>").addClass('dialog').html(
        "<b>Entering Fullscreen mode from inside RISE is disabled.</b>" +
          "<br>" +
          "<b>Exit RISE, make you browser Fullscreen and re-enter RISE</b>" +
          "<br>" +
          "That will help Reveal.js to perform the correct transformations " +
          "at the time to interact with code cells."
      )
    );

    Jupyter.dialog.modal({
      title : "Fullscreen Help",
      body : message,
      buttons : {
        OK : {class: "btn-danger"}
      }
    });

  }

  function removeHash() {
    history.pushState("", document.title, window.location.pathname
                      + window.location.search);
  }

  function Remover() {
    // before its first start finishes, reveal has no input handlers to unbind yet
    if (Reveal.isReady()) {
      Reveal.configure({minScale: 1.0});
      Reveal.removeEventListeners();
    }
    clearTimeout(pending_sync);
    removeRevealListeners();
    $('body').removeClass("rise-enabled");
    let theme = complete_config.theme;
    $('body').removeClass(`theme-${theme}`);
    $('div#header').show();

    $('div#notebook').removeClass("reveal");
    // woekaround to fix fade class conflicting between notebook and reveal css...
    if ($('div#notebook').hasClass('fade')) { $('div#notebook').removeClass("fade"); };
    $('div#notebook-container').removeClass("slides");
    $('div#notebook-container').css('width','');
    $('div#notebook-container').css('height','');
    $('div#notebook-container').css('zoom','');

    $('#theme').remove();
    $('#revealcss').remove();
    $('#chalkboardcss').remove();
    $('#rise-custom-css').remove();
    $('#rise-notebook-css').remove();

    revealChrome().hide();

    let cells = Jupyter.notebook.get_cells();
    for (let cell of cells) {
      cell.element.removeClass('reveal-skip');
      $('div#notebook-container').append(cell.element);
    }

    $('div#notebook-container').children('section').remove();
    $('.end_space').show();

    disconnectOutputObserver();
    removeHash();
    removeHeaderFooterOverlay();
  }

  /*
    using Reveal.getCurrentSlide() it is possible to get a lot of data
    about where we are in the slideshow

    the following function inspects this and returns a triple
    [slide, subslide, fragments]

    slide and subslide both start at 0 (1st slide numbered 0)

    fragments is the number of <fragments> tags currently showed
    that is to say, **in addition** to the slide beginning
    note that a jupyter cell cannot be a slide *and* a fragment at the same time
    the first slide however may be different as the first cell may be a fragment
    which I chose not to support for now
    bottom line: is fragments also starts at 0

    ---------- historical note

    in a previous implementation - for traditional notebooks -
    we used to get slide and subslide from window.location.href
    however this in jupyter lab may be no longer possible

    in addition this is the way to go for getting info on the current fragment
  */
  function reveal_current_position() {
    let current_slide = Reveal.getCurrentSlide();
    // reveal shows nothing until its first start finishes
    if (!current_slide) {
      return [0, 0, 0];
    }
    // href of the form slide-2-3
    let href = current_slide.id;
    let chunks = href.split('-');
    let slide = Number(chunks[1]);
    let subslide = Number(chunks[2]);
    let fragments = $(current_slide).find('div.fragment.visible').length;
    return [slide, subslide, fragments];
  }


  /* Just before exiting reveal mode, we run this function
   * whose job is to find the notebook index
   * for the first cell in the current (sub)slide
   * this allows to restore the notebook at the correct location,
   * i.e. with that cell being selected
   *
   * if cell_type is not set, returns the first cell in slide
   * otherwise, it returns the first cell of that type in slide
   *
   * if auto_select_fragment is set to true, search is restricted to the current fragment
   * otherwise, the whole slide is considered
   *
   * returns null if no match is found
   */
  function reveal_cell_index(notebook, cell_type=null, auto_select_fragment=false) {
    /* scan all cells until we find one that matches current reveal location
     * need to deal carefully with beginning of that process because
     * (.) we do not impose a starting 'slide', and
     * (.) the first cell(s) might be of type 'skip'
     *     which then must not be counted
     */
    let [slide, subslide, fragment] = reveal_current_position();

    // like markupSlides, slide, subslide and fragment cells only start something new once
    // the first slide has visible content
    let [slide_counter, subslide_counter, fragment_counter] = [0, 0, 0];
    let content_seen = false;
    let result = null;

    let cells = notebook.get_cells();
    for (let index in cells) {
      let cell = cells[index];
      // ignore skip cells no matter what
      if (is_skip(cell) || is_notes(cell))
        continue;
      if (content_seen && is_slide(cell)) {
        slide_counter += 1;
        subslide_counter = 0;
      }
      if (content_seen && is_subslide(cell)) {
        subslide_counter += 1;
      }

      if ((slide_counter == slide) && (subslide_counter == subslide)) {
        // keep count of fragments but only on current slide
        if (content_seen && is_fragment(cell)) {
          fragment_counter += 1;
        }
        /* we're on the right slide
         * now: do we need to also worry about focusing on the right fragment ?
         * if auto_select_fragment is true, we only consider cells in the fragment
         * otherwise, the whole (sub)slide is considered valid
         */
        let fragment_match = (auto_select_fragment) ? (fragment_counter == fragment) : true;
        // we still need to match cell types
        if ( fragment_match &&
	     ((cell_type === null) || (cell.cell_type == cell_type))) {
	  return index;
        }
      }
      content_seen = true;
    }
    // for consistency with previous implementations
    return null;
  }

  function registerJupyterActions() {

    // accessing Jupyter.actions directly results in a warning message
    // https://github.com/jupyter/notebook/issues/2401
    let actions = Jupyter.notebook.keyboard_manager.actions;

    // register main action
    actions.register(
      {help:    "Enter/Exit RISE Slideshow",
       handler: revealMode},
      "slideshow", "RISE");

    actions.register(
      {help:    "execute cell, and move to the next if on the same slide",
       handler: smartExec},
      "smart-exec", "RISE");

    // helpers for toggling slide_type
    function init_metadata_slideshow(optional_cell) {
      // use selected cell if not specified
      let cell = optional_cell || Jupyter.notebook.get_selected_cell();
      let metadata = cell.metadata;
      if (metadata.slideshow === undefined)
        metadata.slideshow = {};
      return metadata.slideshow;
    }

    // new_type can be any of 'slide' 'subslide' 'fragment' 'notes' 'skip'
    function toggle_slide_type(new_type) {
      let slideshow = init_metadata_slideshow();
      slideshow.slide_type = (slideshow.slide_type == new_type) ? '' : new_type;
      Jupyter.CellToolbar.rebuild_all();
    }

    actions.register(
      {help   : '(un)set current cell as a Slide cell',
       handler: () => toggle_slide_type('slide')},
      "toggle-slide", "RISE");

    actions.register(
      {help   : '(un)set current cell as a Sub-slide cell',
       handler: () => toggle_slide_type('subslide')},
      "toggle-subslide", "RISE");

    actions.register(
      {help   : '(un)set current cell as a Fragment cell',
       handler: () => toggle_slide_type('fragment')},
      "toggle-fragment", "RISE");

    actions.register(
      {help   : '(un)set current cell as a Note cell',
       handler: () => toggle_slide_type('notes')},
      "toggle-notes", "RISE");

    actions.register(
      {help   : '(un)set current cell as a Skip cell',
       handler: () => toggle_slide_type('skip')},
      "toggle-skip", "RISE");


    actions.register(
      {help   : 'render all cells (all cells go to command mode)',
       handler: () => Jupyter.notebook.get_cells().forEach(
         cell => cell.render())},
      "render-all-cells", "RISE");

    actions.register(
      {help   : 'edit all cells (all cells go to edit mode)',
       handler: () => Jupyter.notebook.get_cells().forEach(
         cell => cell.unrender())},
      "edit-all-cells", "RISE");

    // because the `Edit Keyboard Shortcuts` utility does not mention the
    // actions prefix (i.e. 'RISE' in our case), we choose to make this
    // action name start with `rise-` even if it's a bit redundant.

    // mostly for debug / information
    actions.register(
      {help   : 'output RISE configuration in console, for debugging mostly',
       handler: showConfig},
      "rise-dump-config", "RISE");
    
    let reveal_bindings = updateRevealBindings(reveal_default_bindings);
    // register all reveal.js actions for keyboard bindings
    for (const module of Object.keys(reveal_bindings)){
      for (const action of Object.keys(reveal_bindings[module])){
        let api_call = reveal_actions[module][action];
        actions.register({
          help: reveal_helpstr[module][action], 
          handler: api_call},
          action, "RISE");
        // console.log(`Registered jupyter action \"${action}\" to API call: ${api_call}`);
      }
    }
    
  }


  // the entrypoint - call this to enter or exit reveal mode
  function revealMode() {
    // We search for a class tag in the maintoolbar to check if reveal mode is "on".
    // If the tag exits, we exit. Otherwise, we enter the reveal mode.
    let tag = $('#maintoolbar').hasClass('reveal_tagging');

    if (!tag) {
      // Preparing the new reveal-compatible structure
      let selected_slide = markupSlides($('div#notebook-container'));
      // Adding the reveal stuff
      Revealer(selected_slide);
      // Minor modifications for usability
      setupKeys("reveal_mode");
      buttonExit();
      buttonHelp();
      $('#maintoolbar').addClass('reveal_tagging');
    } else {
      // first use current selection if relevant, the first cell in the visible slide otherwise
      let current_cell_index = Jupyter.notebook.get_selected_index();
      if (current_cell_index === null) {
        current_cell_index = reveal_cell_index(Jupyter.notebook);
      }
      Remover();
      setupKeys("notebook_mode");
      $('#exit_b').remove();
      $('#help_b').remove();
      $('#maintoolbar').removeClass('reveal_tagging');
      // Workaround... should be a better solution. Need to investigate codemirror
      fixCellHeight();
      // select and focus on current cell
      Jupyter.notebook.select(current_cell_index);
      // Need to delay the action a little bit so it actually focus the selected slide
      setTimeout(() => Jupyter.notebook.get_selected_cell().ensure_focused(),
                 complete_config.restore_timeout);
    }
  }

  function autoSelectHook() {
    let auto_select = complete_config.auto_select;
    let cell_type =
        (auto_select == "code") ? 'code'
	: (auto_select == "first") ? null
	: undefined;

    /* turned off altogether */
    if (cell_type === undefined) {
      return;
    }

    let auto_select_fragment = complete_config.auto_select_fragment;
    setTimeout(function(){
      let current_cell_index = reveal_cell_index(
        Jupyter.notebook, cell_type, auto_select_fragment);
      // select and focus on current cell
      if (current_cell_index !== null)
        Jupyter.notebook.select(current_cell_index);
    }, complete_config.auto_select_timeout);
  }

  function addButtonsAndShortcuts() {

    // create button
    Jupyter.toolbar.add_buttons_group([{
      action  : "RISE:slideshow",
      icon    : complete_config.toolbar_icon,
      id      : 'RISE',
    }]);

    //////// bind to keyboard shortcut
    let shortcuts = complete_config.shortcuts;
    for (let action_name in complete_config.shortcuts) {
      let shortcut = shortcuts[action_name];
      // ignore if shortcut is set to an empty string
      if (shortcut) {
        // console.log(`RISE: adding shortcut ${shortcut} for RISE:${action_name}`);
        Jupyter.notebook.keyboard_manager.command_shortcuts.add_shortcut(
          shortcut, `RISE:${action_name}`);
      }
    }
  }

  function showConfig() {
    console.log("RISE configuration", complete_config);
  }


  /* load_jupyter_extension */
  function setup() {
    // load css first
    $('<link/>')
      .attr({rel: "stylesheet",
             href: require.toUrl("./main.css"),
             id: 'maincss',
            })
      .appendTo('head');

    configLoaded()
    //      .then(showConfig)
      .then(registerJupyterActions)
      .then(addButtonsAndShortcuts)
      .then(enterSlideshowInSpeakerView)
    ;

  }

  setup.load_ipython_extension = setup;
  setup.load_jupyter_extension = setup;

  return setup;
});

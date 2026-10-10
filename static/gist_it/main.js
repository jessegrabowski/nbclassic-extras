/*
 * gist_it: publish the open notebook as a GitHub gist, or update the gist it was published to.
 *
 * The Jupyter server publishes through the GitHub CLI, as the user gh is logged in as there, so
 * no token ever reaches the browser; see nbclassic_extras/gist.py.
 */
define([
    'jquery',
    'base/js/namespace',
    'base/js/dialog',
    'base/js/utils',
], function ($, Jupyter, dialog, utils) {
    "use strict";

    const GIST_ID = /^[0-9a-f]+$/i;
    // gh can take a while to push a large notebook to GitHub
    const REQUEST_TIMEOUT_MS = 90000;
    // how long the id field must stay unchanged before the gist is looked up
    const LOOKUP_DELAY_MS = 300;

    let default_public = false;

    function readSettings() {
        default_public = Boolean(Jupyter.notebook.config.data.gist_it_default_to_public);
    }

    function serverRequest(method, path, body) {
        return utils.ajax(utils.url_path_join(Jupyter.notebook.base_url, 'gist_it', path), {
            type: method,
            dataType: 'json',
            contentType: 'application/json',
            data: (body === undefined) ? undefined : JSON.stringify(body),
            timeout: REQUEST_TIMEOUT_MS,
        });
    }

    function errorMessage(jqXHR, textStatus) {
        let message = (jqXHR.responseJSON || {}).message;
        if (message) {
            return message;
        }
        if (jqXHR.status) {
            return `The Jupyter server answered ${jqXHR.status}.`;
        }
        return (textStatus === 'timeout') ? 'The Jupyter server did not answer in time.'
                                          : 'The Jupyter server could not be reached.';
    }

    // the gist this notebook was published to, as nbclassic's gist_it has always stored it
    function savedGist() {
        let gist = Jupyter.notebook.metadata.gist || {};
        let data = gist.data || {};
        return {
            id: (typeof gist.id === 'string') ? gist.id : '',
            filename: gist.filename,
            description: (typeof data.description === 'string') ? data.description
                                                                 : Jupyter.notebook.notebook_path,
            public: (typeof data.public === 'boolean') ? data.public : default_public,
        };
    }

    function rememberGist(id, description, is_public) {
        Jupyter.notebook.metadata.gist = {
            id: id,
            filename: Jupyter.notebook.notebook_name,
            data: {description: description, public: is_public},
        };
        Jupyter.notebook.set_dirty(true);
    }

    // the server builds the gist from these fields alone; a renamed notebook's old file is dropped
    function publishRequest(id, description, is_public) {
        return {
            id: id,
            description: description,
            public: is_public,
            filename: Jupyter.notebook.notebook_name,
            previous_filename: savedGist().filename,
            content: JSON.stringify(Jupyter.notebook.toJSON(), null, 1),
        };
    }

    function alertBox(kind, content) {
        return $('<div/>')
            .addClass(`alert alert-${kind}`)
            .append(content);
    }

    // one line of status text: muted for information, colored for an outcome
    function statusLine(kind, icon, content) {
        let color = (kind === 'info') ? 'text-muted' : `text-${kind}`;
        return $('<span/>')
            .addClass(color)
            .append($('<i/>').addClass(`fa fa-fw ${icon}`))
            .append(content);
    }

    function gistEditor(saved) {
        let form = $('<form/>').attr('id', 'gist_editor');

        $('<div/>').addClass('form-group')
            .append($('<label/>').attr('for', 'gist_id').text('Gist id'))
            .append($('<input/>').addClass('form-control').attr('id', 'gist_id')
                    .attr('placeholder', 'Leave empty to create a new gist').val(saved.id))
            .append($('<p/>').attr('id', 'gist_id_status').addClass('help-block'))
            .appendTo(form);
        $('<div/>').addClass('form-group')
            .append($('<label/>').attr('for', 'gist_description').text('Description'))
            .append($('<input/>').addClass('form-control').attr('id', 'gist_description')
                    .val(saved.description))
            .appendTo(form);
        $('<div/>').addClass('checkbox')
            .append($('<label/>')
                    .append($('<input/>').attr({type: 'checkbox', id: 'gist_public'})
                            .prop('checked', saved.public))
                    .append('Public'))
            .append($('<p/>').addClass('help-block').text(
                'Public gists are listed on your GitHub profile; secret ones are reachable only '
                + 'through their link.'))
            .appendTo(form);
        return form;
    }

    /*
     * Checks the gist id field and says what publishing will do: create a gist, update an existing
     * one, or nothing, for an id that is not a gist. Only the latest lookup reports.
     */
    function idChecker(modal) {
        let pending = null;
        let lookup = null;

        function report(kind, icon, content, can_publish) {
            modal.find('#gist_id_status').empty().append(statusLine(kind, icon, content));
            modal.find('.btn-primary').prop('disabled', !can_publish);
        }

        function check() {
            let id = modal.find('#gist_id').val().trim();
            if (lookup !== null) {
                lookup.abort();
                lookup = null;
            }
            if (id === '') {
                report('info', 'fa-plus', 'A new gist will be created.', true);
                return;
            }
            if (!GIST_ID.test(id)) {
                report('danger', 'fa-times', 'A gist id is made of the letters a-f and digits only.',
                       false);
                return;
            }
            report('info', 'fa-spinner fa-spin', 'Looking up the gist...', false);
            lookup = serverRequest('GET', `gists/${id}/commits`);
            lookup
                .done((reply) => {
                    let revisions = (reply.revisions === 1) ? '1 revision'
                                                            : `${reply.revisions} revisions`;
                    report('success', 'fa-check',
                           `Gist ${id} will be updated; it has ${revisions} so far.`, true);
                })
                .fail((jqXHR, textStatus) => {
                    if (textStatus === 'abort') {
                        return;
                    }
                    if (jqXHR.status === 404) {
                        report('danger', 'fa-times',
                               'No gist with this id is visible to your GitHub account.', false);
                    } else {
                        let problem = errorMessage(jqXHR, textStatus);
                        report('warning', 'fa-exclamation-triangle',
                               `The gist could not be checked. ${problem}`, true);
                    }
                });
        }

        return {
            now: check,
            afterTyping() {
                clearTimeout(pending);
                pending = setTimeout(check, LOOKUP_DELAY_MS);
            },
        };
    }

    function publish(modal, onPublished) {
        let id = modal.find('#gist_id').val().trim();
        let description = modal.find('#gist_description').val();
        let is_public = modal.find('#gist_public').prop('checked');
        let result = modal.find('#gist_result');

        modal.find('.btn').prop('disabled', true);
        result.empty();
        serverRequest('POST', 'gists', publishRequest(id, description, is_public))
            // re-enabled first, so the lookup that follows a publish can disable it again
            .always(() => modal.find('.btn').prop('disabled', false))
            .done((gist) => {
                rememberGist(gist.id, description, is_public);
                modal.find('#gist_id').val(gist.id);
                let done = (gist.revisions > 1) ? ` updated to revision ${gist.revisions}.`
                                                : ' published.';
                result.append(alertBox('success', $('<span/>')
                    .append('Gist ')
                    .append($('<a/>').attr({href: gist.html_url, target: '_blank'}).text(gist.id))
                    .append(done)));
                onPublished();
            })
            .fail((jqXHR, textStatus) => {
                result.append(alertBox('danger', errorMessage(jqXHR, textStatus)));
            });
    }

    // says which GitHub account the server publishes as, or why it cannot publish
    function showAccount(modal) {
        let account = modal.find('#gist_account');
        serverRequest('GET', 'account')
            .done((reply) => {
                account.empty().append(statusLine('info', 'fa-github', $('<span/>')
                    .append('Publishing as ')
                    .append($('<strong/>').text(reply.login))
                    .append('.')));
            })
            .fail((jqXHR, textStatus) => {
                account.empty().append(alertBox('danger', errorMessage(jqXHR, textStatus)));
            });
    }

    function showGistEditor() {
        let body = $('<div/>')
            .append($('<div/>').attr('id', 'gist_account').addClass('form-group'))
            .append(gistEditor(savedGist()))
            .append($('<div/>').attr('id', 'gist_result'));
        let checker = null;
        let modal = dialog.modal({
            title: 'Share on GitHub',
            body: body,
            notebook: Jupyter.notebook,
            keyboard_manager: Jupyter.notebook.keyboard_manager,
            buttons: {
                'Gist it!': {
                    class: 'btn-primary',
                    // the new revision shows in the id check once publishing finishes
                    click: () => publish(modal, () => checker.now()),
                },
                Close: {},
            },
        }).attr('id', 'gist_modal');
        // publishing reports its result in the dialog, so its button leaves the dialog open
        modal.find('.btn-primary').removeAttr('data-dismiss');

        showAccount(modal);
        checker = idChecker(modal);
        modal.find('#gist_id').on('input', checker.afterTyping);
        checker.now();
    }

    function initialize() {
        readSettings();
        let action = Jupyter.keyboard_manager.actions.register({
            help: 'Create or update a gist of this notebook',
            icon: 'fa-github',
            handler: showGistEditor,
        }, 'create-gist-from-notebook', 'gist_it');
        Jupyter.toolbar.add_buttons_group([action]);
    }

    function load_jupyter_extension() {
        return Jupyter.notebook.config.loaded.then(initialize);
    }

    return {
        load_jupyter_extension: load_jupyter_extension,
        load_ipython_extension: load_jupyter_extension,
    };
});

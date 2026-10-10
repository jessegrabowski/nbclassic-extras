"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadGistIt } = require("../harness");

const GIST_ACTION = "gist_it:create-gist-from-notebook";
const ACCOUNT = { status: 200, body: { login: "octocat" } };

function published(id, revisions) {
    return { status: 200, body: { id: id, html_url: `https://gist.github.com/${id}`, revisions } };
}

const HOSTILE_IDS = [
    ["markup", 'abc123#<img src="x" onerror="window.injected = 1">'],
    ["a path outside the gists endpoint", "../../user/repos"],
];

HOSTILE_IDS.forEach(([kind, id]) => {
    test(`a gist id holding ${kind} is refused without a lookup`, async (t) => {
        const gistIt = await loadGistIt({ metadata: { gist: { id: id } } });
        t.after(gistIt.close);
        const { $ } = gistIt;

        gistIt.run(GIST_ACTION);
        await gistIt.idle(10);

        assert.match($("#gist_id_status").text(), /letters a-f and digits only/);
        assert.equal($("#gist_modal img").length, 0);
        assert.ok($("#gist_modal .btn-primary").prop("disabled"));
        assert.deepEqual(gistIt.requests.map((request) => request.url), ["/gist_it/account"]);
    });
});

test("the dialog names the GitHub account the server publishes as", async (t) => {
    const gistIt = await loadGistIt({});
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    await gistIt.until(() => $("#gist_account").text() !== "");

    assert.equal($("#gist_account").text(), "Publishing as octocat.");
});

test("a server that cannot publish says why in the dialog", async (t) => {
    const message = "The GitHub CLI (gh) is not installed on the Jupyter server.";
    const gistIt = await loadGistIt({ server: () => ({ status: 503, body: { message } }) });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    await gistIt.until(() => $("#gist_account").text() !== "");

    assert.equal($("#gist_account").text(), message);
});

test("publishing a new gist sends the notebook, its description and visibility", async (t) => {
    const gistIt = await loadGistIt({
        metadata: { gist: { data: { description: "Talk" } } },
        server: (request) => request.method === "POST" ? published("abc123", 1) : ACCOUNT,
    });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    $("#gist_modal .btn-primary").trigger("click");
    await gistIt.until(() => $("#gist_result a").length > 0);

    const request = gistIt.requests.find((sent) => sent.method === "POST");
    assert.equal(request.url, "/gist_it/gists");
    assert.equal(request.body.id, "");
    assert.equal(request.body.description, "Talk");
    assert.equal(request.body.public, false);
    assert.equal(request.body.filename, "talk.ipynb");
    assert.ok(JSON.parse(request.body.content).cells);
    assert.equal($("#gist_result").text(), "Gist abc123 published.");
    assert.equal($("#gist_result a").attr("href"), "https://gist.github.com/abc123");
    assert.equal($("#gist_modal").length, 1);
});

test("an existing gist is looked up, then updated under the notebook's new name", async (t) => {
    const saved = { id: "abc123", filename: "old.ipynb", data: { description: "Talk", public: true } };
    let revisions = 2;
    const gistIt = await loadGistIt({
        metadata: { gist: saved },
        notebookName: "new.ipynb",
        server: (request) => {
            if (request.method === "POST") {
                revisions += 1;
                return published("abc123", revisions);
            }
            return request.url === "/gist_it/account"
                ? ACCOUNT
                : { status: 200, body: { revisions: revisions } };
        },
    });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    await gistIt.until(() => /will be updated/.test($("#gist_id_status").text()));
    assert.equal($("#gist_id_status").text(), "Gist abc123 will be updated; it has 2 revisions so far.");
    $("#gist_modal .btn-primary").trigger("click");
    await gistIt.until(() => $("#gist_result a").length > 0);

    const update = gistIt.requests.find((request) => request.method === "POST");
    assert.equal(update.body.id, "abc123");
    assert.equal(update.body.filename, "new.ipynb");
    assert.equal(update.body.previous_filename, "old.ipynb");
    assert.equal($("#gist_result").text(), "Gist abc123 updated to revision 3.");
    // the dialog checks the gist again, so its status shows the new revision
    await gistIt.until(() => /3 revisions/.test($("#gist_id_status").text()));
    assert.equal(gistIt.notebook.metadata.gist.filename, "new.ipynb");
    assert.ok(gistIt.notebook.dirty);
});

test("publishing stays disabled while the published gist is looked up again", async (t) => {
    const gistIt = await loadGistIt({
        server: (request) => {
            if (request.method === "POST") {
                return published("abc123", 1);
            }
            return request.url === "/gist_it/account"
                ? ACCOUNT
                : { status: 200, body: { revisions: 1 }, delay: 50 };
        },
    });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    $("#gist_modal .btn-primary").trigger("click");
    await gistIt.until(() => $("#gist_result a").length > 0);

    assert.equal($("#gist_id_status").text(), "Looking up the gist...");
    assert.ok($("#gist_modal .btn-primary").prop("disabled"));
    await gistIt.until(() => /will be updated/.test($("#gist_id_status").text()));
    assert.equal($("#gist_modal .btn-primary").prop("disabled"), false);
});

test("a gist the GitHub account cannot see disables publishing", async (t) => {
    const gistIt = await loadGistIt({
        metadata: { gist: { id: "abc123" } },
        server: (request) => request.url === "/gist_it/account"
            ? ACCOUNT
            : { status: 404, body: { message: "GitHub answered 404: Not Found" } },
    });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    await gistIt.until(() => /No gist/.test($("#gist_id_status").text()));

    assert.ok($("#gist_modal .btn-primary").prop("disabled"));
});

test("typing a gist id looks up only the id left in the field", async (t) => {
    const gistIt = await loadGistIt({
        server: (request) => request.url === "/gist_it/account"
            ? ACCOUNT
            : { status: 200, body: { revisions: 1 } },
    });
    t.after(gistIt.close);
    const { $ } = gistIt;
    gistIt.run(GIST_ACTION);
    const field = $("#gist_id");

    for (const typed of ["a", "ab", "abc"]) {
        field.val(typed).trigger("input");
    }
    await gistIt.until(() => /will be updated/.test($("#gist_id_status").text()));

    const lookups = gistIt.requests.filter((request) => request.url !== "/gist_it/account");
    assert.deepEqual(lookups.map((request) => request.url), ["/gist_it/gists/abc/commits"]);
});

test("a failed publish shows the server's message and keeps the gist unsaved", async (t) => {
    const gistIt = await loadGistIt({
        server: (request) => request.method === "POST"
            ? { status: 401, body: { message: "GitHub answered 401: Bad credentials" } }
            : ACCOUNT,
    });
    t.after(gistIt.close);
    const { $ } = gistIt;

    gistIt.run(GIST_ACTION);
    $("#gist_modal .btn-primary").trigger("click");
    await gistIt.until(() => $("#gist_result").text() !== "");

    assert.equal($("#gist_result").text(), "GitHub answered 401: Bad credentials");
    assert.equal(gistIt.notebook.metadata.gist, undefined);
    assert.equal(gistIt.notebook.dirty, false);
});

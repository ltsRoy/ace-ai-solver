// Runs in the page's own JS world so it can reach the live Ace editors.
// Content scripts live in an isolated world and can't see `ace` or `el.env`.
(() => {
  const TAG = "__ace_gemini__";

  function toEditor(el) {
    if (!el) return null;
    if (el.env && el.env.editor) return el.env.editor;
    return window.ace ? window.ace.edit(el) : null;
  }

  // Prefer a known id (ReactAce name="code-editor"); otherwise the largest editable Ace.
  function mainEditor() {
    const known = toEditor(document.getElementById("code-editor"));
    if (known) return known;
    const eds = [...document.querySelectorAll(".ace_editor")].map((el) => ({ el, ed: toEditor(el) })).filter((x) => x.ed);
    const score = (x) => (x.ed.getReadOnly() ? 0 : 1e9) + x.el.offsetWidth * x.el.offsetHeight;
    return eds.sort((a, b) => score(b) - score(a))[0]?.ed || null;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.tag !== TAG || e.data.dir !== "toPage") return;
    const { id, cmd, code } = e.data;
    const editor = mainEditor();
    let reply;

    if (!editor) {
      reply = { ok: false, error: "No Ace editor found on this page" };
    } else if (cmd === "read") {
      reply = {
        ok: true,
        code: editor.getValue(),
        mode: editor.session.getMode().$id || "", // e.g. "ace/mode/python"
        readOnly: editor.getReadOnly(),
        // Readonly template sections around the editable part (if the site has them)
        prefix: toEditor(document.getElementById("prefix-editor"))?.getValue() || "",
        suffix: toEditor(document.getElementById("suffix-editor"))?.getValue() || ""
      };
    } else if (cmd === "write") {
      if (editor.getReadOnly()) {
        reply = { ok: false, error: "Editor is read-only (already submitted / max submissions?)" };
      } else {
        // Fires Ace's "change" event -> frameworks like ReactAce sync their own state from it
        editor.setValue(code, 1);
        editor.clearSelection();
        editor.focus();
        reply = { ok: true, written: editor.getValue() === code };
      }
    } else {
      reply = { ok: false, error: "Unknown command " + cmd };
    }

    window.postMessage({ tag: TAG, dir: "toContent", id, ...reply }, "*");
  });
})();

// Isolated-world script: floating button, reads the question, runs the solve -> test -> fix loop.
(() => {
  const TAG = "__ace_gemini__";
  const LANGS = { python: "Python 3", c_cpp: "C++", java: "Java", c: "C", javascript: "JavaScript" };
  let seq = 0;

  // ---- Site profiles. Only used locally to find elements; nothing here is sent to Gemini. ----
  const PROFILES = [
    {
      // Coding-practice site: split prefix/editable/suffix editors, "Compile & Run" + "Submit"
      detect: () => document.querySelector('.programming-action-buttons, [id^="unit-"][id$="-list"]'),
      strict: true, // Submit only after Compile & Run shows compilation OK and all tests passed
      title: ".assessment-header-title",
      // Current tab is solvable only if it's an unfinished programming assignment with an editor
      onSolvable: () => {
        const isCode = document.getElementById("code-editor") && document.querySelector(".programming-action-buttons");
        if (!isCode && !isQuizPage()) return false;
        const cur = document.querySelector('[id^="unit-"][id$="-list"] button.border-blue-600');
        return !cur || !cur.querySelector(".lucide-circle-check");
      },
      question: [".question-html-content", ".programming-question-text"],
      samples: ".programming-test-cases-table",
      language: ".programming-dropdown-button",
      buttons: ".programming-action-buttons button",
      runLabels: ["Compile & Run"],
      submitLabels: ["Submit"],
      result: ".programming-evaluation-container, .programming-compilation-errors, .programming-test-case-row",
      extraResult: [".programming-alert-success"],
      failedRows: ".programming-evaluation-container .programming-test-case-row",
      closeModal: ".assessment-modal-close",
      next: sidebarNext
    }
  ];

  // Sidebar: units are [id=unit-N-list] containing item buttons; the open item has border-blue-600,
  // finished items show a lucide-circle-check icon. Next = first unfinished programming
  // assignment after the current one, expanding collapsed units on the way.
  async function sidebarNext() {
    const isPA = (b) => /programming assignment|quiz/i.test(b.innerText);
    const done = (b) => !!b.querySelector(".lucide-circle-check");
    const after = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    const current = document.querySelector('[id^="unit-"][id$="-list"] button.border-blue-600');
    if (!current) return null;
    for (let guard = 0; guard < 40; guard++) {
      const items = [...document.querySelectorAll('[id^="unit-"][id$="-list"] > button')];
      const hit = items.find((b) => after(current, b) && isPA(b) && !done(b));
      if (hit) return hit;
      const closed = [...document.querySelectorAll('button[aria-controls^="unit-"][aria-expanded="false"]')]
        .find((h) => after(current, h));
      if (!closed) return null;
      closed.click();
      await sleep(900);
    }
    return null;
  }

  // Generic profile for any other site; popup overrides win.
  function genericProfile(cfg) {
    return {
      question: [cfg.questionSel, "[class*=question]", "[class*=problem]", "[class*=description]"].filter(Boolean),
      language: cfg.languageSel || "",
      buttons: "button, input[type=submit], [role=button]",
      runLabels: splitLabels(cfg.runLabels) || ["Compile & Run", "Run Code", "Run", "Compile"],
      submitLabels: splitLabels(cfg.submitLabels) || ["Submit", "Submit Code"],
      result: cfg.resultSel || "[class*=result], [class*=output], [class*=verdict], [class*=console]",
      extraResult: [],
      failedRows: "",
      closeModal: ""
    };
  }
  const splitLabels = (s) => (s && s.trim() ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);
  const pickProfile = (cfg) => {
    const p = PROFILES.find((p) => p.detect());
    return p ? { ...p, ...(cfg.resultSel ? { result: cfg.resultSel } : {}) } : genericProfile(cfg);
  };

  // ---- page bridge ----
  function toPage(cmd, extra = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener("message", on); reject(new Error("Page bridge timed out")); }, 3000);
      function on(e) {
        if (e.source !== window || e.data?.tag !== TAG || e.data.dir !== "toContent" || e.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", on);
        e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
      }
      window.addEventListener("message", on);
      window.postMessage({ tag: TAG, dir: "toPage", id, cmd, ...extra }, "*");
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (sel) => (sel && document.querySelector(sel)?.innerText.trim()) || "";
  const textAll = (sel) => (sel ? [...document.querySelectorAll(sel)].map((n) => n.innerText.trim()).filter(Boolean).join("\n") : "");

  function readQuestion(p) {
    let q = "";
    for (const sel of p.question) if ((q = textOf(sel))) break;
    if (!q) {
      // Last resort: page text minus editors/buttons/nav
      const c = document.body.cloneNode(true);
      c.querySelectorAll(".ace_editor, script, style, nav, header, footer, button, #ace-gemini-btn").forEach((n) => n.remove());
      q = c.innerText.trim().slice(0, 15000);
    }
    const s = textOf(p.samples);
    return s ? `${q}\n\nSAMPLE TEST CASES:\n${s}` : q;
  }

  function readLanguage(p, mode) {
    const shown = textOf(p.language);
    if (shown && shown.length < 30) return shown;
    const m = mode.replace("ace/mode/", "");
    return LANGS[m] || m || "unknown";
  }

  function findButton(p, labels) {
    const btns = [...document.querySelectorAll(p.buttons)].filter((b) => b.offsetParent !== null && b.id !== "ace-gemini-btn");
    const label = (b) => (b.innerText || b.value || "").trim().toLowerCase();
    for (const l of labels) {
      const hit = btns.find((b) => label(b) === l.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  const resultText = (p) => [textAll(p.result), ...p.extraResult.map(textOf)].filter(Boolean).join("\n");

  // Judging is request/response: wait until the result area changes and settles.
  // The same verdict twice leaves the text unchanged, so also watch the button's
  // disabled -> enabled cycle (the site disables actions while a request is in flight).
  async function waitResult(p, before, getBtn, timeoutMs = 90000) {
    const end = Date.now() + timeoutMs;
    let last = "", stableSince = 0, sawBusy = false;
    while (Date.now() < end) {
      await sleep(300);
      if (getBtn()?.disabled) { sawBusy = true; continue; }
      const now = resultText(p);
      const busy = /\b(running|judging|pending|queued|compiling|evaluating|submitting)\b|\.\.\.|…/i.test(now.slice(0, 200));
      if (!now || busy || (now === before && !sawBusy)) continue;
      if (now !== last) { last = now; stableSince = Date.now(); continue; }
      if (Date.now() - stableSince > 800) return now;
    }
    return last || null;
  }

  // Turn the page's verdict into pass/fail + feedback text for Gemini.
  function classify(p, text) {
    if (!text) return { pass: false, unknown: true, feedback: "No result was shown." };
    if (p.strict) return classifyStrict(p, text);
    const tests = [...text.matchAll(/(\d+)\s*\/\s*(\d+)\s*(passed|test)/gi)].map((m) => [+m[1], +m[2]]);
    const compileFail = /compilation\s*\|?\s*failed|compil\w*\s+error|syntax\s*error|cannot find symbol|undefined reference|traceback|exception|error:/i.test(text);
    const wrong = /wrong answer|failed|time limit|runtime error|memory limit|incorrect/i.test(text);
    const allTestsPass = tests.length > 0 && tests.every(([a, b]) => b > 0 && a === b);
    const accepted = /accepted|all test cases passed|compilation\s*\|?\s*successful/i.test(text);

    if (allTestsPass && !compileFail) return { pass: true };
    if (!tests.length && accepted && !compileFail && !wrong) return { pass: true };
    if (!compileFail && !wrong && !tests.length) return { pass: false, unknown: true, feedback: text };

    const rows = p.failedRows ? textAll(p.failedRows) : "";
    const kind = compileFail ? "COMPILATION / RUNTIME ERROR" : "WRONG OUTPUT ON SOME TESTS";
    return { pass: false, feedback: `${kind}\n${text}${rows && !text.includes(rows) ? "\n\nTEST DETAILS:\n" + rows : ""}`.slice(0, 6000) };
  }

  // "Public Test Cases" table after Compile & Run:
  //   Test Case | Input | Expected Output | Output | Status ("-" / Passed / Failed)
  // Each row is compared directly: Output must equal Expected Output.
  function readTestRows() {
    const norm = (s) => (s || "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n").trim();
    return [...document.querySelectorAll(".programming-evaluation-container .programming-test-case-row, .programming-test-case-row")]
      .map((row) => {
        const cells = [...row.querySelectorAll(".programming-test-case-cell")].map((c) => c.innerText);
        if (cells.length < 3) return null;
        const [input, expected, output, status = ""] = cells;
        const name = row.innerText.split("\n")[0].trim();
        const statusFail = /fail|wrong|error|incorrect/i.test(status);
        return { name, input: norm(input), expected: norm(expected), output: norm(output), status: status.trim(),
                 ok: !statusFail && norm(output) === norm(expected) };
      })
      .filter(Boolean);
  }

  // Strict: pass ONLY if nothing failed to compile, the test table exists, and EVERY row's
  // Output === Expected Output (and an "X/Y Passed" summary, if shown, agrees).
  function classifyStrict(p, text) {
    const compileFail = /compilation\s*\|?\s*failed/i.test(text) || !!textOf(".programming-compilation-errors");
    const tests = [...text.matchAll(/(\d+)\s*\/\s*(\d+)\s*passed/gi)].map((m) => [+m[1], +m[2]]);
    const summaryBad = tests.some(([a, b]) => a !== b);
    const rows = readTestRows();
    const allRowsOk = rows.length > 0 && rows.every((r) => r.ok);
    console.log("[Ace Gemini] test rows:", rows);

    if (!compileFail && !summaryBad && allRowsOk) return { pass: true };

    if (compileFail) {
      const errs = textOf(".programming-compilation-errors") || text;
      return { pass: false, feedback: `COMPILATION ERROR:\n${errs}`.slice(0, 6000) };
    }
    if (!rows.length) return { pass: false, feedback: `No test results were produced. Output area:\n${text}`.slice(0, 6000) };
    const bad = rows.filter((r) => !r.ok)
      .map((r) => `${r.name}\nINPUT:\n${r.input}\nEXPECTED OUTPUT:\n${r.expected}\nYOUR OUTPUT:\n${r.output || "(empty)"}`)
      .join("\n\n");
    return { pass: false, feedback: `WRONG OUTPUT (must match exactly, including spacing/newlines/decimals):\n\n${bad}`.slice(0, 6000) };
  }

  async function clickAndWait(p, btn, labels) {
    const before = resultText(p);
    btn.click();
    const r = await waitResult(p, before, () => findButton(p, labels));
    if (p.closeModal) document.querySelector(p.closeModal)?.click();
    return r;
  }

  // Images inside the question area (question may be a screenshot). Only pixel data goes to Gemini.
  function questionImages(p) {
    const root = p.question.map((s) => document.querySelector(s)).find(Boolean);
    if (!root) return [];
    return [...root.querySelectorAll("img")]
      .filter((img) => img.naturalWidth >= 40 && img.naturalHeight >= 20)
      .map((img) => img.currentSrc || img.src).filter(Boolean).slice(0, 6);
  }

  // Stable id for "which question is on screen", used to detect navigation.
  const fingerprint = (p) => (textOf(p.title) + "|" +readQuestion(p).slice(0, 400) + "|" + questionImages(p).join(",")).replace(/\s+/g, " ");

  let stopRequested = false, running = false;
  const stopped = () => { if (stopRequested) throw new Error("Stopped"); };

  // Visible pause between steps. Per-step setting (seconds) wins; blank = the "all steps" delay.
  const DELAY_KINDS = ["delayRead", "delayPaste", "delayResult", "delaySubmit", "delayNext"];
  async function pause(cfg, kind, set, label) {
    const own = cfg[kind];
    const secs = Math.max(0, +(own !== undefined && own !== "" ? own : cfg.delayAll) || 0);
    for (let left = secs; left > 0; left -= 0.5) {
      stopped();
      set(`${label} — next step in ${Math.ceil(left)}s`);
      await sleep(Math.min(500, left * 1000));
    }
    stopped();
  }

  // Solves the question currently on screen. Returns true if it passed and was submitted.
  async function solveCurrent(p, cfg, set) {
    const maxAttempts = Math.max(1, Math.min(10, +cfg.maxAttempts || 4));
    set("Reading…");
    const ed = await toPage("read");
    if (ed.readOnly) throw new Error("Editor is read-only");
    const task = {
      question: readQuestion(p),
      images: questionImages(p),
      language: readLanguage(p, ed.mode),
      starterCode: ed.code, prefix: ed.prefix, suffix: ed.suffix
    };
    if (!task.question && !task.images.length) throw new Error("Question not found");
    console.log("[Ace Gemini] question read:", task.question.slice(0, 300), task.images);
    await pause(cfg, "delayRead", set, `Read question (${task.language})`);

    const history = []; // [{code, feedback}] from earlier attempts
    let passed = false, lastVerdict = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      stopped();
      set(`Asking AI (try ${attempt}/${maxAttempts})…`);
      const res = await chrome.runtime.sendMessage({ type: "solve", ...task, history });
      if (!res?.ok) throw new Error(res?.error || "No response from background");

      stopped();
      set("Pasting…");
      const w = await toPage("write", { code: res.code });
      if (!w.written) throw new Error("Editor didn't accept the code");
      await sleep(300); // let the framework commit its onChange state
      await pause(cfg, "delayPaste", set, `Pasted try ${attempt}`);

      if (cfg.autoSubmit === false) { set("Pasted ✓ (auto-test off)"); return false; }

      // Test with Run when the site has it (doesn't burn submissions); else Submit is the test.
      const runBtn = findButton(p, p.runLabels);
      if (p.strict && !runBtn) throw new Error("Compile & Run not found; refusing to submit untested code");
      const testBtn = runBtn || findButton(p, p.submitLabels);
      if (!testBtn) throw new Error("No Run/Submit button found — set labels in the popup");
      if (testBtn.disabled) throw new Error("Run/Submit is disabled (max submissions reached?)");

      set(`${runBtn ? "Running" : "Submitting"} (try ${attempt})…`);
      lastVerdict = await clickAndWait(p, testBtn, runBtn ? p.runLabels : p.submitLabels);
      const v = classify(p, lastVerdict);
      console.log(`[Ace Gemini] try ${attempt}:`, v.pass ? "PASS" : "FAIL", lastVerdict);
      await pause(cfg, "delayResult", set, v.pass ? `Run passed (try ${attempt})` : `Run failed (try ${attempt}), will fix`);

      if (v.pass) {
        passed = true;
        // Tested with Run -> now do the real submit
        if (runBtn) {
          const submitBtn = findButton(p, p.submitLabels);
          if (!submitBtn) throw new Error("Passed, but Submit button not found");
          if (submitBtn.disabled) throw new Error("Submit is disabled (max submissions reached?)");
          set("Passed — submitting…");
          lastVerdict = await clickAndWait(p, submitBtn, p.submitLabels) || lastVerdict;
          await pause(cfg, "delaySubmit", set, "Submitted");
          const s = classify(p, lastVerdict);
          if (!s.pass && !s.unknown && !/success/i.test(lastVerdict)) {
            passed = false; // hidden tests failed: keep fixing
            history.push({ code: res.code, feedback: "Passed sample tests but FAILED on submit (hidden tests):\n" + s.feedback });
            continue;
          }
        }
        break;
      }
      if (v.unknown && !runBtn) { passed = true; break; } // submitted, couldn't read verdict: assume done
      history.push({ code: res.code, feedback: v.feedback });
    }

    set(passed ? "✓ " + (lastVerdict || "Done").split("\n")[0].slice(0, 70)
               : `✗ Not solved after ${maxAttempts} tries`);
    return passed;
  }

  // ---------------- MCQ quizzes ----------------
  const CHOICE = 'input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]';
  const inSidebar = (el) => !!el.closest('[id^="unit-"], nav, aside, #ace-gemini-btn');
  const choices = (root = document) => [...root.querySelectorAll(CHOICE)].filter((el) => !inSidebar(el));
  const isQuizPage = () => !document.getElementById("code-editor") && choices().length >= 2;

  // Group options into questions, then grow each group to its "card" (question text + options).
  function readQuiz() {
    const groups = new Map();
    for (const el of choices()) {
      let key = (el.name && `name:${el.name}`) || el.closest("[role=radiogroup]");
      if (!key) { // unnamed: first ancestor holding 2+ options
        let a = el.parentElement;
        while (a && choices(a).length < 2) a = a.parentElement;
        key = a;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    }
    const qs = [];
    for (const opts of groups.values()) {
      let card = opts[0].parentElement;
      while (card && !opts.every((o) => card.contains(o))) card = card.parentElement;
      while (card?.parentElement && choices(card.parentElement).length === opts.length) card = card.parentElement;
      if (!card) continue;
      const letters = opts.map((o, i) => optionLetter(o) || String.fromCharCode(97 + i));
      const multi = opts.some((o) => o.type === "checkbox" || o.getAttribute("role") === "checkbox");
      const imgs = [...card.querySelectorAll("img")].filter((i) => i.naturalWidth >= 40).map((i) => i.currentSrc || i.src);
      qs.push({ card, opts, letters, multi, imgs, text: card.innerText.trim().slice(0, 4000) });
    }
    qs.sort((a, b) => (a.card.compareDocumentPosition(b.card) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    qs.forEach((q, i) => (q.id = String(i + 1)));
    return qs;
  }

  // "a." / "(b)" / "C)" next to the radio -> letter
  function optionLetter(el) {
    const lab = el.labels?.[0] || el.closest("label") || el.parentElement;
    const t = (lab?.innerText || el.getAttribute("aria-label") || el.value || "").trim();
    const m = t.match(/^\(?([a-hA-H])[.)\]:]?(\s|$)/);
    return m ? m[1].toLowerCase() : "";
  }

  const isChecked = (el) => el.checked === true || el.getAttribute("aria-checked") === "true";
  async function choose(el, want) {
    if (isChecked(el) === want) return;
    (el.labels?.[0] || el).click();
    await sleep(120);
    if (isChecked(el) !== want) { el.click(); await sleep(120); }
  }

  async function solveQuizPage(cfg, set) {
    const qs = readQuiz();
    if (!qs.length) throw new Error("No quiz questions found");
    if (qs.every((q) => q.opts.every((o) => o.disabled || o.getAttribute("aria-disabled") === "true")))
      { set("Quiz already submitted / closed"); return true; }
    console.log("[Ace Gemini] quiz:", qs.map((q) => ({ id: q.id, letters: q.letters, multi: q.multi, text: q.text.slice(0, 80) })));
    await pause(cfg, "delayRead", set, `Read ${qs.length} quiz questions`);

    set(`Asking AI (${qs.length} MCQs)…`);
    const res = await chrome.runtime.sendMessage({
      type: "quiz",
      questions: qs.map(({ id, letters, multi, text }) => ({ id, letters, multi, text })),
      images: qs.flatMap((q) => q.imgs).slice(0, 10)
    });
    if (!res?.ok) throw new Error(res?.error || "No response from background");
    console.log("[Ace Gemini] quiz answers:", res.answers);

    set("Selecting answers…");
    let answered = 0;
    for (const q of qs) {
      stopped();
      let pick = res.answers[q.id] ?? res.answers[+q.id];
      pick = (Array.isArray(pick) ? pick : [pick]).map((x) => String(x || "").trim().toLowerCase().replace(/[^a-h]/g, "")).filter(Boolean);
      if (!q.multi) pick = pick.slice(0, 1);
      if (!pick.length) continue;
      for (let i = 0; i < q.opts.length; i++) {
        const want = pick.includes(q.letters[i]);
        if (want || q.multi) await choose(q.opts[i], want);
      }
      if (q.opts.some(isChecked)) answered++;
      q.card.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(150);
    }
    if (answered < qs.length) console.warn(`[Ace Gemini] only ${answered}/${qs.length} questions got a selection`);
    await pause(cfg, "delayPaste", set, `Selected ${answered}/${qs.length} answers`);
    if (cfg.autoSubmit === false) { set(`Selected ${answered}/${qs.length} (auto-submit off)`); return false; }

    const submit = findButton({ buttons: "button, input[type=submit], [role=button]" },
      ["Submit Answers", "Submit Quiz", "Submit Assignment", "Submit"]);
    if (!submit) throw new Error("Quiz Submit button not found");
    if (submit.disabled) throw new Error("Quiz Submit is disabled");
    set("Submitting quiz…");
    submit.click();

    // Confirmation popup ("Are you sure?") -> confirm; then wait for a success message
    const end = Date.now() + 20000;
    let confirmed = false, ok = false;
    while (Date.now() < end) {
      await sleep(500);
      const dlg = document.querySelector('[role=dialog], [role=alertdialog], .assessment-modal-overlay, [class*=modal]');
      if (dlg && !confirmed) {
        const yes = [...dlg.querySelectorAll("button")].find((b) => /^(yes|confirm|submit|ok|proceed)/i.test(b.innerText.trim()));
        if (yes) { yes.click(); confirmed = true; continue; }
      }
      if (/successfully submitted|submitted successfully|your answers.*submitted|score/i.test(document.body.innerText)) { ok = true; break; }
    }
    document.querySelector(".assessment-modal-close")?.click();
    await pause(cfg, "delaySubmit", set, ok ? "Quiz submitted" : "Quiz submit clicked (no confirmation seen)");
    return true;
  }

  // Next question: site button by label, else rel=next link.
  function findNext(p, cfg) {
    const labels = splitLabels(cfg.nextLabels) || ["Next", "Next Question", "Next Problem", "Save & Next", "Next Assignment", "Continue"];
    const any = { buttons: "button, a, [role=button]" };
    return findButton(any, labels) || document.querySelector("a[rel=next]");
  }

  async function goNext(p, cfg, set) {
    const before = fingerprint(p);
    const next = (p.next && !cfg.nextLabels ? await p.next() : null) || findNext(p, cfg);
    if (!next) return false;
    set("Going to next question…");
    await chrome.storage.local.set({ chainActive: true }); // survives a full page reload
    next.click();
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      await sleep(700);
      stopped();
      if ((document.querySelector(".ace_editor") || isQuizPage()) && fingerprint(p) !== before) {
        await sleep(1500); // let the new editor + template settle
        await pause(cfg, "delayNext", set, "Opened next question");
        return true;
      }
    }
    return false;
  }

  async function run(btn) {
    if (running) { stopRequested = true; btn.textContent = "Stopping…"; await chrome.storage.local.set({ chainActive: false }); return; }
    running = true; stopRequested = false;
    const set = (t) => (btn.textContent = t + "  (click to stop)");
    try {
      const cfg = await chrome.storage.local.get(["autoSubmit", "autoNext", "maxAttempts", "questionSel", "languageSel", "resultSel", "runLabels", "submitLabels", "nextLabels", "delayAll", ...DELAY_KINDS]);
      const p = pickProfile(cfg);
      const seen = new Set();
      let solved = 0;
      while (true) {
        stopped();
        const fp = fingerprint(p);
        if (seen.has(fp)) { set(`Done: ${solved} solved (next led to a repeat)`); break; }
        seen.add(fp);

        // Started on a lecture / quiz / finished tab: just move on to the next open assignment
        if (p.onSolvable && !p.onSolvable()) {
          set("Not an open assignment, moving on…");
          if (!(await goNext(p, cfg, set))) { set(`Done: ${solved} solved (no more assignments)`); break; }
          continue;
        }
        const ok = isQuizPage() ? await solveQuizPage(cfg, set) : await solveCurrent(p, cfg, set);
        if (!ok) break;           // stop the chain on a failure so you can look at it
        solved++;
        if (cfg.autoNext === false || cfg.autoSubmit === false) break;
        await sleep(1000);
        if (!(await goNext(p, cfg, set))) { set(`Done: ${solved} solved (no next question)`); break; }
      }
    } catch (err) {
      console.error("[Ace Gemini]", err);
      set("Error: " + err.message.slice(0, 60));
    } finally {
      running = false;
      await chrome.storage.local.set({ chainActive: false });
      setTimeout(() => { if (!running) btn.textContent = "Solve with AI"; }, 15000);
    }
  }

  // SPA-safe: the editor can mount/unmount without a reload, so keep the button in sync.
  function sync() {
    const existing = document.getElementById("ace-gemini-btn");
    const onCourse = PROFILES.some((pr) => pr.detect());
    if (!document.querySelector(".ace_editor") && !onCourse) { if (!running) existing?.remove(); return; }
    if (existing) return;
    const btn = document.createElement("button");
    btn.id = "ace-gemini-btn";
    btn.textContent = "Solve with AI";
    // "Next" caused a full reload mid-chain: pick up where we left off
    chrome.storage.local.get("chainActive").then(({ chainActive }) => {
      if (chainActive && !running) setTimeout(() => run(btn), 2000);
    });
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
      padding: "10px 14px", borderRadius: "8px", border: "none", cursor: "pointer",
      background: "#1a73e8", color: "#fff", font: "600 13px system-ui", maxWidth: "360px",
      boxShadow: "0 4px 14px rgba(0,0,0,.25)"
    });
    btn.onclick = () => run(btn);
    document.body.appendChild(btn);
  }

  sync();
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
})();

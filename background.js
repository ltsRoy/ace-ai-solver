// Holds the Groq / Gemini calls so the API keys never touch the page.
// Privacy: the model only ever sees the question, language and code. Nothing identifying the site
// (URL, hostname, title, selectors, cookies) is put in the prompt, and text is scrubbed first.
// ---- Anonymous usage counters (shown as badges on the GitHub README) ----
// Only increments a public counter: no ID, no URL, no question/code, nothing about the user.
// Opt out in the popup ("Send anonymous usage counts").
const STATS = "https://abacus.jasoncameron.dev/hit/ltsroy-ace-ai-solver/";
async function bump(key) {
  const { noStats } = await chrome.storage.local.get("noStats");
  if (noStats) return;
  fetch(STATS + key, { credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => {});
}
// "active-days": at most one bump per install per calendar day, only when it's actually used
async function markActive() {
  const today = new Date().toISOString().slice(0, 10);
  const { lastActive } = await chrome.storage.local.get("lastActive");
  if (lastActive === today) return;
  await chrome.storage.local.set({ lastActive: today });
  bump("active-days");
}
chrome.runtime.onInstalled.addListener(({ reason }) => { if (reason === "install") bump("installs"); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "stat") { if (msg.key === "solved") bump("solved"); return; }
  if (msg.type === "solve" || msg.type === "quiz") markActive();
  const handler = { solve, quiz: solveQuiz }[msg.type];
  if (!handler) return;
  handler(msg, sender.tab?.url).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true; // keep the channel open for the async reply
});

// Remove URLs, emails and any mention of the current site's hostname / brand word.
function makeScrubber(tabUrl) {
  const words = new Set();
  try {
    const host = new URL(tabUrl).hostname.replace(/^www\./, "");
    words.add(host);
    const parts = host.split(".");
    // brand label, e.g. "acme" from "learn.acme.co.in"
    const skip = new Set(["com", "org", "net", "edu", "gov", "co", "in", "io", "ai", "app", "dev", "www", "learn", "lms", "portal"]);
    parts.filter((w) => w.length >= 4 && !skip.has(w)).forEach((w) => words.add(w));
  } catch {}
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const siteRe = words.size ? new RegExp([...words].map(esc).join("|"), "gi") : null;
  return (s) => {
    if (!s) return s;
    s = s.replace(/\bhttps?:\/\/\S+/gi, "[url]")
         .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]")
         .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|io|ai|in|co|app|dev)\b(\/\S*)?/gi, "[domain]");
    return siteRe ? s.replace(siteRe, "[site]") : s;
  };
}

// Fetch question images here (with the user's cookies, so protected images work) and send only
// the bytes to Gemini: the image URL itself never leaves the extension.
async function imageParts(urls = []) {
  const parts = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith("image/") || blob.size > 4e6) continue;
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      parts.push({ inline_data: { mime_type: blob.type, data: btoa(bin) } });
    } catch {}
  }
  return parts;
}

async function solve({ question, images, language, starterCode, prefix, suffix, history = [] }, tabUrl) {
  const cfg = await chrome.storage.local.get(["provider", "apiKey", "model", "groqKey", "groqModel"]);
  if (!cfg.groqKey && !cfg.apiKey) throw new Error("Set a Groq or Gemini API key in the extension popup");
  const clean = makeScrubber(tabUrl);

  const split = prefix || suffix;
  const first =
    `You are solving a coding problem. Language: ${clean(language)}.\n` +
    `Return ONLY code, no explanation, no markdown fences.\n` +
    (split
      ? `The file is split into three parts. PREFIX and SUFFIX are fixed and already provided; ` +
        `the grader joins PREFIX + your code + SUFFIX. Return ONLY the EDITABLE part and do not ` +
        `repeat anything from PREFIX or SUFFIX.\n`
      : `Return the complete code for the editor. Keep any given function/class signatures exactly.\n`) +
    `\nQUESTION:\n${clean(question) || "(see attached image)"}\n` +
    (images?.length ? `The question also includes the attached image(s); read them carefully.\n` : "") +
    (prefix ? `\nPREFIX (fixed, read-only):\n${clean(prefix)}\n` : "") +
    `\nEDITABLE PART (current contents / template):\n${clean(starterCode) || "(empty)"}\n` +
    (suffix ? `\nSUFFIX (fixed, read-only):\n${clean(suffix)}\n` : "");

  // Provider-neutral conversation: previous attempts go back as the model's answers + judge feedback.
  const turns = [{ role: "user", text: first }];
  history.forEach((h, i) => {
    turns.push({ role: "model", text: h.code });
    turns.push({
      role: "user",
      text:
        `That attempt (#${i + 1}) did not pass. Judge output:\n${clean(h.feedback)}\n\n` +
        `Find the actual cause (compile error line, wrong output format, edge case, off-by-one, ` +
        `performance, input parsing) and fix it. Do not just repeat the same approach` +
        (i >= 1 ? " — multiple attempts failed, so reconsider the algorithm and re-read the I/O format" : "") +
        `. Return ONLY the corrected ${split ? "EDITABLE part" : "code"}, no fences.`
    });
  });
  const temperature = history.length ? 0.4 : 0.2;

  return { ok: true, code: stripFences(await askAI(cfg, turns, images, temperature)) };
}

// Order: chosen provider first, the other as fallback. Groq models here can't see images,
// so an image question goes to Gemini first when a Gemini key exists.
async function askAI(cfg, turns, images, temperature) {
  const groq = () => callGroq(cfg.groqKey, cfg.groqModel, turns, temperature);
  const gemini = async () => callGemini(cfg.apiKey, cfg.model, await geminiContents(turns, images), temperature);
  let order = (cfg.provider || "groq") === "gemini" ? [gemini, groq] : [groq, gemini];
  if (images?.length && cfg.apiKey) order = [gemini, groq];
  order = order.filter((f) => (f === groq ? cfg.groqKey : cfg.apiKey));

  const errors = [];
  for (const call of order) {
    try { return await call(); }
    catch (e) { errors.push(e.message); console.warn("[Ace Gemini]", e.message); }
  }
  throw new Error(errors.join(" | ").slice(0, 300));
}

// ---- MCQ quiz: all questions in one request, answers back as JSON letters ----
async function solveQuiz({ questions, images }, tabUrl) {
  const cfg = await chrome.storage.local.get(["provider", "apiKey", "model", "groqKey", "groqModel"]);
  if (!cfg.groqKey && !cfg.apiKey) throw new Error("Set a Groq or Gemini API key in the extension popup");
  const clean = makeScrubber(tabUrl);
  const body = questions.map((q) =>
    `QUESTION ${q.id} (${q.multi ? "select ALL correct options" : "exactly ONE correct option"}; ` +
    `options: ${q.letters.join(", ")}):\n${clean(q.text)}`).join("\n\n-----\n\n");
  const prompt =
    `Answer these multiple-choice questions. Think carefully, then reply with ONLY a JSON object ` +
    `mapping each question number to an array of option letters, e.g. {"1":["a"],"2":["b","d"]}. ` +
    `Use only the listed letters. No explanation.\n\n${body}`;
  const text = await askAI(cfg, [{ role: "user", text: prompt }], images, 0.1);
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("AI did not return JSON answers");
  let answers;
  try { answers = JSON.parse(json[0]); } catch { throw new Error("AI returned malformed JSON"); }
  return { ok: true, answers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBusy = (status, msg) => [429, 500, 502, 503, 504].includes(status) || /high demand|overloaded|unavailable|try again|rate limit/i.test(msg);

// Tries each model in order; overloaded/rate-limited -> backoff 2s,4s,8s; retired/unknown -> next model.
async function withModels(models, label, attempt) {
  let lastErr = "";
  for (const m of [...new Set(models.filter(Boolean))]) {
    for (let retry = 0; retry < 3; retry++) {
      const { status, ok, text, err } = await attempt(m).catch((e) => ({ status: 504, ok: false, text: "", err: e.name === "TimeoutError" ? "timed out" : e.message }));
      if (ok && text.trim()) return text;
      lastErr = `${label} ${m}: ${ok ? "empty response" : err || "HTTP " + status}`;
      if (ok || !isBusy(status, lastErr)) break;
      await sleep(2000 * 2 ** retry + Math.random() * 1000);
    }
    console.warn("[Ace Gemini] falling back from", lastErr);
  }
  throw new Error(lastErr || `${label}: no models`);
}

// ---- Groq (OpenAI-compatible). Default gpt-oss-120b. ----
const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

function callGroq(key, preferred, turns, temperature) {
  const messages = [
    { role: "system", content: "You are an expert competitive programmer. Output only code." },
    ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))
  ];
  return withModels([preferred, ...GROQ_MODELS], "Groq", async (m) => {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      referrerPolicy: "no-referrer",
      credentials: "omit",
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: m, messages, temperature, max_completion_tokens: 4000,
        ...(m.startsWith("openai/gpt-oss") ? { reasoning_effort: "medium" } : {})
      })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, text: data.choices?.[0]?.message?.content || "", err: data.error?.message };
  });
}

// ---- Gemini ----
// Ordered by a live test on 2026-09-24: working + fastest first, then ones that were overloaded (503).
const GEMINI_MODELS = ["gemini-3-flash-preview", "gemini-3.6-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

async function geminiContents(turns, images) {
  const imgs = await imageParts(images);
  return turns.map((t, i) => ({ role: t.role, parts: [{ text: t.text }, ...(i === 0 ? imgs : [])] }));
}

function callGemini(key, preferred, contents, temperature) {
  const body = JSON.stringify({ contents, generationConfig: { temperature } });
  return withModels([preferred, ...GEMINI_MODELS], "Gemini", async (m) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      // no referrer / credentials so the provider doesn't learn which page triggered it
      referrerPolicy: "no-referrer",
      credentials: "omit",
      signal: AbortSignal.timeout(60000),
      body
    });
    const data = await res.json().catch(() => ({}));
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return { status: res.status, ok: res.ok, text, err: data.error?.message };
  });
}

function stripFences(s) {
  const m = s.match(/```[\w+-]*\n([\s\S]*?)```/);
  return (m ? m[1] : s).trim() + "\n";
}

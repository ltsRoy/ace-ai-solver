const fields = ["provider", "groqKey", "groqModel", "apiKey", "model", "maxAttempts", "questionSel", "languageSel", "resultSel", "runLabels", "submitLabels", "nextLabels", "delayAll", "delayRead", "delayPaste", "delayResult", "delaySubmit", "delayNext"];
const checks = ["autoSubmit", "autoNext"];

chrome.storage.local.get([...fields, ...checks]).then((cfg) => {
  fields.forEach((f) => (document.getElementById(f).value = cfg[f] || (f === "provider" ? "groq" : "")));
  checks.forEach((c) => (document.getElementById(c).checked = cfg[c] !== false));
});
chrome.storage.local.get("noStats").then(({ noStats }) => (document.getElementById("stats").checked = !noStats));

document.getElementById("save").onclick = async () => {
  const cfg = {};
  checks.forEach((c) => (cfg[c] = document.getElementById(c).checked));
  fields.forEach((f) => (cfg[f] = document.getElementById(f).value.trim()));
  cfg.noStats = !document.getElementById("stats").checked;
  await chrome.storage.local.set(cfg);
  document.getElementById("status").textContent = "Saved";
};

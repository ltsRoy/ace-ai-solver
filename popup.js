const fields = ["provider", "groqKey", "groqModel", "apiKey", "model", "maxAttempts", "questionSel", "languageSel", "resultSel", "runLabels", "submitLabels", "nextLabels", "delayAll", "delayRead", "delayPaste", "delayResult", "delaySubmit", "delayNext"];
const checks = ["autoSubmit", "autoNext"];

chrome.storage.local.get([...fields, ...checks]).then((cfg) => {
  fields.forEach((f) => (document.getElementById(f).value = cfg[f] || (f === "provider" ? "groq" : "")));
  checks.forEach((c) => (document.getElementById(c).checked = cfg[c] !== false));
});

document.getElementById("save").onclick = async () => {
  const cfg = {};
  checks.forEach((c) => (cfg[c] = document.getElementById(c).checked));
  fields.forEach((f) => (cfg[f] = document.getElementById(f).value.trim()));
  await chrome.storage.local.set(cfg);
  document.getElementById("status").textContent = "Saved";
};

// ---- Update banner ----
const $ = (id) => document.getElementById(id);
const current = chrome.runtime.getManifest().version;
$("myVer").textContent = current;
async function showUpdate() {
  const { update } = await chrome.storage.local.get("update");
  $("update").style.display = update ? "block" : "none";
  if (!update) return;
  $("newVer").textContent = "v" + update.version;
  $("curVer").textContent = "v" + current;
  $("dlUpdate").onclick = () => chrome.tabs.create({ url: update.zip });
}
$("reloadExt").onclick = () => chrome.runtime.reload();
$("checkNow").onclick = async () => {
  $("checkNow").textContent = "checking…";
  await chrome.runtime.sendMessage({ type: "checkUpdate" });
  await showUpdate();
  $("checkNow").textContent = (await chrome.storage.local.get("update")).update ? "update found" : "up to date";
};
showUpdate();

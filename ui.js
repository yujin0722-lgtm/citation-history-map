/* ui.js — モーダル・APIキー・ヘルプ・起動時の自動作成 */

/* ============ モーダル ============ */
const mbg = document.getElementById("modal-bg");
let onOk = null;
function openModal(title, body, ok, okLabel) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").textContent = body;
  const okBtn = document.getElementById("modal-ok"), cBtn = document.getElementById("modal-cancel");
  onOk = ok;
  okBtn.textContent = okLabel || "続行する";
  cBtn.style.display = ok ? "inline-block" : "none";
  mbg.classList.add("open");
  okBtn.focus();
}
document.getElementById("modal-ok").addEventListener("click", () => { mbg.classList.remove("open"); if (onOk) onOk(); });
document.getElementById("modal-cancel").addEventListener("click", () => mbg.classList.remove("open"));
mbg.addEventListener("click", e => { if (e.target === mbg) mbg.classList.remove("open"); });

/* ============ APIキー設定 ============ */
const kbg = document.getElementById("key-bg");
document.getElementById("btn-key").addEventListener("click", openKeyModal);
function openKeyModal() {
  document.getElementById("key-in").value = getApiKey();
  kbg.classList.add("open");
}
document.getElementById("key-save").addEventListener("click", () => {
  const v = document.getElementById("key-in").value.trim();
  if (!v) { return; }
  saveApiKey(v);
  kbg.classList.remove("open");
  if (pendingAuto) { pendingAuto = false; createNetwork(); }
});
document.getElementById("key-cancel").addEventListener("click", () => kbg.classList.remove("open"));
kbg.addEventListener("click", e => { if (e.target === kbg) kbg.classList.remove("open"); });

/* ============ ヘルプ ============ */
const helpBg = document.getElementById("help-bg");
document.getElementById("btn-help").addEventListener("click", () => helpBg.classList.add("open"));
document.getElementById("help-close").addEventListener("click", () => helpBg.classList.remove("open"));
helpBg.addEventListener("click", e => { if (e.target === helpBg) helpBg.classList.remove("open"); });
document.querySelectorAll(".help-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".help-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".help-sec").forEach(s => { s.hidden = (s.id !== btn.dataset.tab); });
  });
});

/* ============ 起動時：URLパラメータからの自動作成 ============ */
function applyUrlSettings(sp) {
  const map = [
    ["col", "color-sel"], ["dir", "dir-sel"],
    ["lim", "limit-sel"], ["keep", "keep-sel"], ["size", "size-sel"], ["imp", "imp-sel"]
  ];
  for (const [k, id] of map) {
    const v = sp.get(k);
    if (!v) continue;
    const el = document.getElementById(id);
    if ([...el.options].some(o => o.value === v)) {
      el.value = v;
      el.dispatchEvent(new Event("change"));
    }
  }
  const clu = sp.get("clu");
  if (clu !== null) {
    const c = document.getElementById("cluster-chk");
    c.checked = (clu === "1");
    c.dispatchEvent(new Event("change"));
  }
}
(function () {
  const sp = new URLSearchParams(location.search);
  const idParam = sp.get("id");
  if (!idParam) return;
  applyUrlSettings(sp);
  document.getElementById("paper-in").value = idParam;
  if (getApiKey()) {
    createNetwork();
  } else {
    pendingAuto = true;
    openKeyModal();
  }
})();

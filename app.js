/* app.js — 画面全体の制御 */

const WARN_NODES = 100;
const MAX_NODES = 300;

let favorites = loadFavorites();
let busy = false;

/* ============ 起動 ============ */
Graph.init({
  onSelect: p => { renderPanel(p); openPanel(); },
  onBackground: () => { renderEmptyPanel(); }
});

document.getElementById("btn-create").addEventListener("click", createNetwork);
document.getElementById("paper-in").addEventListener("keydown", e => { if (e.key === "Enter") createNetwork(); });
document.getElementById("dir-sel").addEventListener("change", e => Graph.setDirectionFilter(e.target.value));
document.getElementById("cluster-chk").addEventListener("change", e => {
  document.getElementById("keep-sel").disabled = !e.target.checked;
  Graph.setClusterEnabled(e.target.checked);
});
document.getElementById("keep-sel").addEventListener("change", e => Graph.setKeepTop(parseInt(e.target.value, 10)));
document.getElementById("limit-sel").addEventListener("change", () => {
  if (!currentRoot || busy) return;
  const rebuild = () => {
    document.getElementById("paper-in").value = currentRoot.doi || currentRoot.pmid || "";
    createNetwork();
  };
  const hasExpanded = [...Graph.papers.values()].some(p => p.rel === "expanded");
  if (hasExpanded) {
    openModal("表示件数の変更",
      "表示件数を反映するため、ネットワークを作り直します。展開で追加した論文はリセットされます。続行しますか？",
      rebuild);
  } else {
    rebuild();
  }
});
document.getElementById("btn-fullscreen").addEventListener("click", () => {
  const on = document.body.classList.toggle("fullscreen");
  const btn = document.getElementById("btn-fullscreen");
  btn.textContent = on ? "⛶ 全画面を終了" : "⛶ 全画面表示";
  setTimeout(() => { if (Graph.cy) { Graph.cy.resize(); Graph.cy.fit(undefined, 40); } }, 60);
});
document.getElementById("btn-settings").addEventListener("click", () => {
  const sp = document.getElementById("settings-panel");
  const tf = document.getElementById("typefilter-row");
  const show = sp.hidden;
  sp.hidden = !show;
  tf.hidden = !show;
  setTimeout(() => { if (Graph.cy) Graph.cy.resize(); }, 60);
});

/* 研究タイプ絞り込み */
function currentTypeSet() {
  const set = new Set();
  document.querySelectorAll(".tf-chk").forEach(c => { if (c.checked) set.add(c.value); });
  return set;
}
function typeFilterActive() {
  return document.querySelectorAll(".tf-chk:not(:checked)").length > 0;
}
function applyTypeFilterFromUI() {
  const set = currentTypeSet();
  Graph.setTypeFilter(set);
  updateLimitCap();
  document.getElementById("tf-empty").hidden = (set.size > 0);
}
document.querySelectorAll(".tf-chk").forEach(c => c.addEventListener("change", applyTypeFilterFromUI));
document.getElementById("tf-none").addEventListener("click", () => {
  document.querySelectorAll(".tf-chk").forEach(c => { c.checked = false; });
  applyTypeFilterFromUI();
});
document.getElementById("tf-all").addEventListener("click", () => {
  document.querySelectorAll(".tf-chk").forEach(c => { c.checked = true; });
  applyTypeFilterFromUI();
});

/* 表示件数の上限制御：200件以上はタイプを絞ったときのみ選択可 */
function updateLimitCap() {
  const active = typeFilterActive();
  document.querySelectorAll("#limit-sel option").forEach(o => {
    if (o.value === "200") o.disabled = !active;
  });
  // 絞り込み解除で200/300が選ばれていたら100に戻す
  const sel = document.getElementById("limit-sel");
  if (!active && sel.value === "200") {
    sel.value = "100";
  }
}
updateLimitCap();
document.getElementById("size-sel").addEventListener("change", e => Graph.setSizeMode(e.target.value));
document.getElementById("btn-legend").addEventListener("click", () => Graph.setLegendVisible(!Graph.legendVisible));
document.getElementById("legend-toggle").addEventListener("click", () => {
  const legend = document.getElementById("legend");
  const collapsed = legend.classList.toggle("collapsed");
  document.getElementById("legend-toggle").setAttribute("aria-expanded", String(!collapsed));
  document.getElementById("legend-caret").textContent = collapsed ? "▸" : "▾";
});
// 画面が低いときは凡例を初期状態で畳んでおく（ボタンとの重なり回避）
if (window.innerHeight < 720) {
  document.getElementById("legend").classList.add("collapsed");
  document.getElementById("legend-caret").textContent = "▸";
  document.getElementById("legend-toggle").setAttribute("aria-expanded", "false");
}
document.getElementById("color-sel").addEventListener("change", e => {
  Graph.setColorMode(e.target.value);
  document.getElementById("imp-tool").hidden = (e.target.value !== "importance");
});
document.getElementById("imp-sel").addEventListener("change", e => Graph.setImpPreset(e.target.value));
document.getElementById("btn-relayout").addEventListener("click", () => Graph.runLayout());
document.getElementById("search-in").addEventListener("input", e => Graph.search(e.target.value.trim()));

if (!HAS_STORAGE) {
  showInputError("このブラウザではデータ保存（Local Storage）が利用できないため、お気に入りとAPIキーは保存されません。通常モードのブラウザでの利用をおすすめします。");
}

/* ============ URL共有・PNG出力 ============ */
let currentRoot = null;
let pendingAuto = false;

function settingsParams() {
  const q = new URLSearchParams();
  q.set("col", document.getElementById("color-sel").value);
  q.set("dir", document.getElementById("dir-sel").value);
  q.set("lim", document.getElementById("limit-sel").value);
  q.set("keep", document.getElementById("keep-sel").value);
  q.set("size", document.getElementById("size-sel").value);
  q.set("imp", document.getElementById("imp-sel").value);
  q.set("clu", document.getElementById("cluster-chk").checked ? "1" : "0");
  return q;
}
function shareUrlFor(p, withSettings) {
  const idv = p.doi ? p.doi : (p.pmid ? p.pmid : null);
  if (!idv) return null;
  let u = location.origin + location.pathname + "?id=" + encodeURIComponent(idv);
  if (withSettings) u += "&" + settingsParams().toString();
  return u;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) { return false; }
}
function openNetworkInNewTab(p) {
  const u = shareUrlFor(p, false);
  if (!u) {
    openModal("ネットワークを開く", "この論文はDOI・PMIDが登録されていないため、ネットワークを作成できません。", null, "閉じる");
    return;
  }
  window.open(u, "_blank", "noopener,noreferrer");
}
async function copyShare(p, withSettings) {
  const u = shareUrlFor(p, withSettings);
  if (!u) {
    openModal("リンクのコピー", "この論文はDOI・PMIDが登録されていないため、リンクを作成できません。", null, "閉じる");
    return;
  }
  const desc = withSettings
    ? "現在の表示設定（レイアウト・色分け・表示対象など）ごとコピーしました。開くと同じ見え方でネットワークが再現されます。"
    : "リンクをコピーしました。開くと、この論文を起点にしたネットワークが自動で作成されます。";
  if (await copyText(u)) {
    openModal("リンクのコピー", desc + "\n\n" + u, null, "閉じる");
  } else {
    openModal("リンクのコピー", "自動コピーができませんでした。以下のURLを手動でコピーしてください。\n\n" + u, null, "閉じる");
  }
}
document.getElementById("btn-share").addEventListener("click", () => {
  if (!currentRoot) {
    openModal("リンクのコピー", "先にネットワークを作成してください。", null, "閉じる");
    return;
  }
  copyShare(currentRoot, true);
});
document.getElementById("btn-png").addEventListener("click", async () => {
  if (Graph.papers.size === 0) {
    openModal("PNG保存", "先にネットワークを作成してください。", null, "閉じる");
    return;
  }
  const uri = await Graph.exportPng();
  const a = document.createElement("a");
  a.href = uri;
  a.download = "citrail_" + (currentRoot ? (currentRoot.pmid || "network") : "network") + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

/* ============ 入力〜ネットワーク作成 ============ */
function displayLimit() { return parseInt(document.getElementById("limit-sel").value, 10); }

function showInputError(msg) {
  const el = document.getElementById("input-error");
  el.textContent = msg;
  el.hidden = false;
}
function clearInputError() { document.getElementById("input-error").hidden = true; }
let lastInfoMsg = "";
function showInputInfo(msg) {
  lastInfoMsg = msg;
  document.getElementById("input-info-text").textContent = msg;
  document.getElementById("input-info").hidden = false;
  document.getElementById("btn-info-show").hidden = true;
}
function clearInputInfo() {
  document.getElementById("input-info").hidden = true;
  document.getElementById("btn-info-show").hidden = true;
  lastInfoMsg = "";
}
document.getElementById("input-info-close").addEventListener("click", () => {
  document.getElementById("input-info").hidden = true;
  document.getElementById("btn-info-show").hidden = !lastInfoMsg;
  setTimeout(() => { if (Graph.cy) Graph.cy.resize(); }, 60);
});
document.getElementById("btn-info-show").addEventListener("click", () => {
  if (!lastInfoMsg) return;
  document.getElementById("input-info-text").textContent = lastInfoMsg;
  document.getElementById("input-info").hidden = false;
  document.getElementById("btn-info-show").hidden = true;
  setTimeout(() => { if (Graph.cy) Graph.cy.resize(); }, 60);
});

function setLoading(text) {
  const box = document.getElementById("loading");
  if (text == null) { box.hidden = true; return; }
  box.hidden = false;
  document.getElementById("loading-text").textContent = text;
}

async function createNetwork() {
  if (busy) return;
  clearInputError();
  clearInputInfo();

  const norm = normalizeInput(document.getElementById("paper-in").value);
  if (norm.error) { showInputError(norm.error); return; }

  if (!getApiKey()) { openKeyModal(); return; }

  busy = true;
  document.getElementById("btn-create").disabled = true;
  try {
    setLoading("論文を確認しています…");
    const root = await fetchRootWork(norm);

    setLoading("引用文献（過去）を取得しています…");
    const past = await fetchPastPapers(root.referencedWorks, displayLimit());

    setLoading("被引用文献（未来）を取得しています…");
    const future = await fetchFuturePapers(root.id, displayLimit());

    setLoading("PubMedから研究種別を取得しています…");
    await enrichStudyTypes([root, ...past.papers, ...future.papers]);

    setLoading("ネットワーク図を作成しています…");
    root.loadedPast = true;
    root.loadedFuture = true;
    document.getElementById("welcome").hidden = true;
    document.getElementById("toolbar").hidden = false;
    Graph.build(root, past.papers, future.papers, new Set(favorites.keys()));
    renderEmptyPanel();
    currentRoot = root;
    const su = shareUrlFor(root);
    if (su) history.replaceState(null, "", su);

    const parts = [];
    parts.push(past.total === 0
      ? "引用文献：OpenAlexには参考文献が登録されていません"
      : "引用文献：OpenAlex登録の参考文献 " + past.total.toLocaleString() + "件中、上位" + past.papers.length + "件を表示");
    parts.push(future.total === 0
      ? "被引用文献：この論文を引用した論文はまだ登録されていません"
      : "被引用文献：" + future.total.toLocaleString() + "件中、上位" + future.papers.length + "件を表示");
    let tail = "　※OpenAlexの登録件数は、実際の論文の参考文献リストと一致しない場合があります。";
    if (past.total === 0) {
      tail += "参考文献が0件と表示される場合、出版社が引用データを公開していないことが原因のことが多く、論文の質とは関係しません（複数のデータベースを確認しても参照が見つからない論文もあります）。";
    }
    showInputInfo(parts.join("　／　") + tail);
  } catch (e) {
    showInputError(apiErrorMessage(e));
  } finally {
    setLoading(null);
    busy = false;
    document.getElementById("btn-create").disabled = false;
  }
}


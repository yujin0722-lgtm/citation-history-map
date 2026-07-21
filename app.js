/* app.js — 画面全体の制御 */

const WARN_NODES = 100;
const MAX_NODES = 300;

let favorites = loadFavorites();
let busy = false;

/* ============ 起動 ============ */
Graph.init({
  onSelect: p => { renderPanel(p); document.getElementById("panel").classList.add("open"); },
  onBackground: () => { renderEmptyPanel(); document.getElementById("panel").classList.remove("open"); }
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
document.getElementById("btn-settings").addEventListener("click", () => {
  const sp = document.getElementById("settings-panel");
  sp.hidden = !sp.hidden;
});
document.getElementById("size-sel").addEventListener("change", e => Graph.setSizeMode(e.target.value));
document.getElementById("btn-legend").addEventListener("click", () => Graph.setLegendVisible(!Graph.legendVisible));
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
  a.download = "citation-history-map_" + (currentRoot ? (currentRoot.pmid || "network") : "network") + ".png";
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
function showInputInfo(msg) {
  const el = document.getElementById("input-info");
  el.textContent = msg;
  el.hidden = false;
}
function clearInputInfo() { document.getElementById("input-info").hidden = true; }

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
      ? "引用文献：OpenAlexに引用文献情報が登録されていません"
      : "引用文献：OpenAlex登録の参考文献 " + past.total.toLocaleString() + "件中、上位" + past.papers.length + "件を表示");
    parts.push(future.total === 0
      ? "被引用文献：この論文を引用した論文はまだ登録されていません"
      : "被引用文献：" + future.total.toLocaleString() + "件中、上位" + future.papers.length + "件を表示");
    showInputInfo(parts.join("　／　") + "　※OpenAlexの登録件数は、実際の論文の参考文献リストと一致しない場合があります。");
  } catch (e) {
    showInputError(apiErrorMessage(e));
  } finally {
    setLoading(null);
    busy = false;
    document.getElementById("btn-create").disabled = false;
  }
}

/* ============ 詳細パネル ============ */
const panel = document.getElementById("panel");

function renderEmptyPanel() {
  panel.innerHTML = '<div class="empty">ノード（論文）を選択すると、ここに詳細が表示されます。<br><br>' +
    "・ノードの大きさ＝被引用数<br>・ノードの形＝研究の種類（暫定判定）<br>・矢印の先＝引用された論文</div>";
}

function authorHtml(list, expandId) {
  if (!list || !list.length) return "著者情報なし";
  if (list.length <= 3) return escapeHtml(list.join("、"));
  return escapeHtml(list.slice(0, 3).join("、")) +
    '　<span class="author-more" id="' + expandId + '">ほか' + (list.length - 3) + "名を表示</span>";
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPanel(p) {
  if (!p) return;
  const fav = favorites.has(p.id);
  panel.innerHTML =
    '<div class="p-top">' +
      '<button class="fav-btn ' + (fav ? "on" : "") + '" id="p-fav" aria-label="お気に入りに登録">' + (fav ? "★" : "☆") + "</button>" +
      "<div>" +
        '<span class="p-tag">' + (REL_LABEL[p.rel] || "") + "</span>" +
        '<span class="p-tag">' + (STUDY_LABEL[p.study] || "") +
          (p.study === "OTHER" ? "" : (p.studySource === "pubmed" ? "（PubMed分類）" : "（暫定判定）")) + "</span>" +
        '<div class="p-title">' + escapeHtml(p.title) + "</div>" +
      "</div>" +
    "</div>" +
    "<dl>" +
      "<dt>著者</dt><dd id='p-authors'>" + authorHtml(p.authors, "p-author-more") + "</dd>" +
      "<dt>出版年</dt><dd>" + (p.year != null ? p.year : "情報なし") + "</dd>" +
      "<dt>雑誌</dt><dd>" + escapeHtml(p.journal || "情報なし") + "</dd>" +
      "<dt>被引用数</dt><dd>" + (p.cites != null ? p.cites.toLocaleString() + " 回" : "取得不能") + "</dd>" +
      "<dt>参考文献</dt><dd>OpenAlex登録 " + (p.referencedWorks ? p.referencedWorks.length : 0) + " 件</dd>" +
      "<dt>DOI</dt><dd>" + escapeHtml(p.doi || "登録なし") + "</dd>" +
      "<dt>PMID</dt><dd>" + escapeHtml(p.pmid || "登録なし") + "</dd>" +
    "</dl>" +
    '<div class="p-actions">' +
      (p.pmid
        ? '<button id="p-pubmed">PubMedを開く</button>'
        : '<span class="note">PubMed登録なし</span>') +
      ((p.doi || p.pmid)
        ? '<button id="p-share">この論文を起点にしたリンクをコピー</button>'
        : "") +
      '<button id="p-past">引用文献を展開</button>' +
      '<button id="p-future">被引用文献を展開</button>' +
    "</div>";

  document.getElementById("p-fav").addEventListener("click", () => toggleFav(p));
  const more = document.getElementById("p-author-more");
  if (more) more.addEventListener("click", () => {
    document.getElementById("p-authors").textContent = p.authors.join("、");
  });
  const pm = document.getElementById("p-pubmed");
  if (pm) pm.addEventListener("click", () => {
    window.open("https://pubmed.ncbi.nlm.nih.gov/" + p.pmid + "/", "_blank", "noopener,noreferrer");
  });
  const sh = document.getElementById("p-share");
  if (sh) sh.addEventListener("click", () => copyShare(p));
  document.getElementById("p-past").addEventListener("click", () => expandNode(p, "past"));
  document.getElementById("p-future").addEventListener("click", () => expandNode(p, "future"));
}

/* ============ 展開 ============ */
function capCheck(addCount) {
  const after = Graph.nodeCount() + addCount;
  if (after > MAX_NODES) {
    openModal("表示上限", "現在のネットワークは表示上限（" + MAX_NODES + "件）に達するため、これ以上追加できません。新しいネットワークとして開き直してください。", null, "閉じる");
    return null;
  }
  return after > WARN_NODES
    ? "\n\n※ 追加後は" + after + "件になります。表示する論文数が多いため、図が見づらくなったり、動作が遅くなったりする可能性があります。"
    : "";
}

async function expandNode(p, dir) {
  if (busy) return;
  busy = true;
  try {
    if (dir === "past") {
      const refs = p.referencedWorks || [];
      if (!refs.length) {
        openModal("引用文献を展開", "この論文には引用文献情報が登録されていません。", null, "閉じる");
        return;
      }
      setLoading("引用文献（過去）を取得しています…");
      const unknownIds = refs.filter(id => !Graph.papers.has(id));
      const fetched = (await fetchWorksByIds(unknownIds)).map(w => toPaper(w, p.id === Graph.rootId ? "past" : "expanded"));
      const known = refs.filter(id => Graph.papers.has(id)).map(id => Graph.papers.get(id));
      const ranked = known.concat(fetched).sort((a, b) => (b.cites || 0) - (a.cites || 0));
      const planned = ranked.slice(0, displayLimit());
      const newOnes = planned.filter(x => !Graph.papers.has(x.id));
      const dup = planned.length - newOnes.length;
      setLoading(null);
      confirmAndAdd(p, "past", refs.length, planned.length, dup, newOnes);
    } else {
      setLoading("被引用文献（未来）を取得しています…");
      const res = await fetchFuturePapers(p.id, displayLimit());
      const rel = (p.id === Graph.rootId) ? "future" : "expanded";
      const papers = res.papers.map(x => { x.rel = rel; return x; });
      const newOnes = papers.filter(x => !Graph.papers.has(x.id));
      const dup = papers.length - newOnes.length;
      setLoading(null);
      if (res.total === 0) {
        openModal("被引用文献を展開", "この論文を引用した論文はまだ登録されていません。", null, "閉じる");
        return;
      }
      confirmAndAdd(p, "future", res.total, papers.length, dup, newOnes);
    }
  } catch (e) {
    setLoading(null);
    openModal("エラー", apiErrorMessage(e), null, "閉じる");
  } finally {
    setLoading(null);
    busy = false;
  }
}

function confirmAndAdd(p, dir, found, plannedCount, dup, newOnes) {
  const dirLabel = (dir === "past") ? "引用文献" : "被引用文献";
  if (!newOnes.length) {
    openModal(dirLabel + "を展開", dirLabel + "が" + found.toLocaleString() + "件見つかりましたが、上位" + plannedCount + "件はすべて表示済みです。表示件数の設定を増やすと、さらに取得できます。", null, "閉じる");
    return;
  }
  const warn = capCheck(newOnes.length);
  if (warn === null) return;
  const msg = dirLabel + "が" + found.toLocaleString() + "件見つかりました。\n" +
    "設定に基づき" + plannedCount + "件を追加します。\n" +
    "このうち" + dup + "件は既に表示されています。\n" +
    "新たに追加される論文は" + newOnes.length + "件です。\n続行しますか？" + warn;
  openModal(dirLabel + "を展開", msg, async () => {
    setLoading("PubMedから研究種別を取得しています…");
    try { await enrichStudyTypes(newOnes); } catch (e) { /* 分類は補助情報 */ }
    setLoading(null);
    Graph.addPapers(newOnes, new Set(favorites.keys()));
    if (dir === "past") p.loadedPast = true; else p.loadedFuture = true;
  });
}

/* ============ お気に入り ============ */
function toggleFav(p) {
  if (favorites.has(p.id)) favorites.delete(p.id);
  else favorites.set(p.id, Object.assign({}, p, { savedAt: new Date().toISOString() }));
  persistFavorites(favorites);
  Graph.updateFavStar(p.id, favorites.has(p.id));
  renderPanel(p);
  renderFavList();
}

const favDrawer = document.getElementById("favlist");
const rankDrawer = document.getElementById("ranklist");
document.getElementById("btn-fav").addEventListener("click", () => {
  renderFavList();
  rankDrawer.classList.remove("open");
  favDrawer.classList.toggle("open");
});

/* ============ 上位リスト ============ */
document.getElementById("btn-rank").addEventListener("click", () => {
  renderRankList();
  favDrawer.classList.remove("open");
  rankDrawer.classList.toggle("open");
});
document.getElementById("rank-sel").addEventListener("change", renderRankList);

function renderRankList() {
  const box = document.getElementById("rank-items");
  const items = Graph.rankPapers(document.getElementById("rank-sel").value, 10);
  if (!items.length) {
    box.innerHTML = '<p class="note">ネットワークを作成すると、ここに上位の論文が表示されます。</p>';
    return;
  }
  box.innerHTML = items.map((it, i) =>
    '<div class="fav-item">' +
      '<span class="rank-num">' + (i + 1) + ".</span>" +
      '<a data-id="' + it.paper.id + '" class="jump">' + escapeHtml(it.paper.title) + "</a>" +
      '<div class="meta">' + it.metric + "　｜　" + (REL_LABEL[it.paper.rel] || "") + "</div>" +
    "</div>"
  ).join("");
  box.querySelectorAll(".jump").forEach(a => a.addEventListener("click", () => {
    Graph.centerOn(a.dataset.id);
    rankDrawer.classList.remove("open");
  }));
}

function renderFavList() {
  const box = document.getElementById("fav-items");
  if (!favorites.size) {
    box.innerHTML = '<p class="note">まだ登録がありません。論文の詳細パネルで ☆ を押すと登録できます。</p>';
    return;
  }
  box.innerHTML = [...favorites.values()].map(d =>
    '<div class="fav-item">' +
      '<a data-id="' + d.id + '" class="jump">' + escapeHtml(d.title) + "</a>" +
      '<div class="meta">' + (d.year != null ? d.year + "年" : "出版年不明") + "・" + escapeHtml(d.journal || "雑誌名情報なし") + "</div>" +
      (d.pmid ? '<button data-pmid="' + d.pmid + '" class="pubmed">PubMed</button>' : "") +
      '<button data-id="' + d.id + '" class="del">削除</button>' +
    "</div>"
  ).join("");
  box.querySelectorAll(".jump").forEach(a => a.addEventListener("click", () => {
    if (Graph.papers.has(a.dataset.id)) {
      Graph.centerOn(a.dataset.id);
      favDrawer.classList.remove("open");
    } else {
      openModal("お気に入り", "この論文は現在のネットワークには表示されていません。PubMedボタンから内容を確認できます。", null, "閉じる");
    }
  }));
  box.querySelectorAll(".pubmed").forEach(b => b.addEventListener("click", () => {
    window.open("https://pubmed.ncbi.nlm.nih.gov/" + b.dataset.pmid + "/", "_blank", "noopener,noreferrer");
  }));
  box.querySelectorAll(".del").forEach(b => b.addEventListener("click", () => {
    favorites.delete(b.dataset.id);
    persistFavorites(favorites);
    Graph.updateFavStar(b.dataset.id, false);
    renderFavList();
  }));
}

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

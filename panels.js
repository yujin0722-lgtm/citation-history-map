/* panels.js — 詳細パネル・展開・お気に入り・上位リスト */

/* ============ 詳細パネル ============ */
const panel = document.getElementById("panel");
const panelContent = document.getElementById("panel-content");

/* パネルの開閉（狭い画面でネットワーク領域を広げるため） */
function openPanel() {
  panel.classList.remove("collapsed");
  panel.classList.add("open");
  setTimeout(() => Graph.cy && Graph.cy.resize(), 60);
}
function collapsePanel() {
  panel.classList.add("collapsed");
  panel.classList.remove("open");
  setTimeout(() => { if (Graph.cy) { Graph.cy.resize(); Graph.cy.fit(undefined, 40); } }, 60);
}
document.getElementById("panel-toggle").addEventListener("click", () => {
  if (panel.classList.contains("collapsed")) openPanel(); else collapsePanel();
});

function renderEmptyPanel() {
  panelContent.innerHTML = '<div class="empty">ノード（論文）を選択すると、ここに詳細が表示されます。<br><br>' +
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
  panelContent.innerHTML =
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
        openModal("引用文献を展開", "この論文にはOpenAlexに参考文献が登録されていません。出版社が引用データを公開していないことが原因のことが多く、論文の質とは関係しません。", null, "閉じる");
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


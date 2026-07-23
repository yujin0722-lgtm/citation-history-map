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
  const pf = pfSelection.has(p.id);
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
    '<label class="pf-check"><input type="checkbox" id="p-pf-check"' + (pf ? " checked" : "") + '> 📌 パスファインダーへ送る</label>' +
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
        ? '<button id="p-share">この論文を起点にしたネットワークを新しいタブで開く</button>'
        : "") +
      '<button id="p-past">引用文献を展開</button>' +
      '<button id="p-future">被引用文献を展開</button>' +
      (p.echo ? "" : '<button id="p-echo" class="echo-btn">エコーロケーション（引用の引用を一気に表示）</button>') +
    "</div>";

  document.getElementById("p-fav").addEventListener("click", () => toggleFav(p));
  document.getElementById("p-pf-check").addEventListener("change", e => togglePf(p, e.target.checked));
  const more = document.getElementById("p-author-more");
  if (more) more.addEventListener("click", () => {
    document.getElementById("p-authors").textContent = p.authors.join("、");
  });
  const pm = document.getElementById("p-pubmed");
  if (pm) pm.addEventListener("click", () => {
    window.open("https://pubmed.ncbi.nlm.nih.gov/" + p.pmid + "/", "_blank", "noopener,noreferrer");
  });
  const sh = document.getElementById("p-share");
  if (sh) sh.addEventListener("click", () => openNetworkInNewTab(p));
  document.getElementById("p-past").addEventListener("click", () => expandNode(p, "past"));
  document.getElementById("p-future").addEventListener("click", () => expandNode(p, "future"));
  const eb = document.getElementById("p-echo");
  if (eb) eb.addEventListener("click", () => openEchoDialog(p));
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
    Graph.addPapers(newOnes, new Set(favorites.keys()), new Set(pfSelection));
    if (dir === "past") p.loadedPast = true; else p.loadedFuture = true;
  });
}

/* ============ パスファインダーへ送る ============ */
const PF_HANDOFF_KEY = "chm_to_pathfinder";
const PATHFINDER_URL = "../pathfinder/"; // CitrailとパスファインダーはGitHub Pagesで兄弟フォルダとして公開される想定

function togglePf(p, on) {
  if (on) pfSelection.add(p.id); else pfSelection.delete(p.id);
  Graph.updatePfMark(p.id, on);
  updatePfSendButton();
}

function updatePfSendButton() {
  const btn = document.getElementById("btn-pf-send");
  if (!btn) return;
  const n = pfSelection.size;
  btn.textContent = "🧭 パスファインダーへ送る（" + n + "）";
  btn.disabled = n === 0;
}

document.getElementById("btn-pf-send").addEventListener("click", () => {
  if (!pfSelection.size) return;
  const payload = [...pfSelection].map(id => Graph.papers.get(id)).filter(Boolean).map(p => ({
    id: p.id, title: p.title, authors: p.authors, year: p.year, journal: p.journal,
    doi: p.doi, pmid: p.pmid, study: p.study, studySource: p.studySource, referencedWorks: p.referencedWorks
  }));
  try {
    localStorage.setItem(PF_HANDOFF_KEY, JSON.stringify(payload));
  } catch (e) {
    openModal("エラー", "パスファインダーへのデータの受け渡しに失敗しました。ブラウザの設定でLocal Storageが使えない可能性があります。", null, "閉じる");
    return;
  }
  window.open(PATHFINDER_URL, "_blank", "noopener,noreferrer");
});

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
  box.innerHTML = [...favorites.values()].map(d => {
    const tip = escapeHtml(d.title) + "（" + (d.year != null ? d.year + "年" : "出版年不明") + "・" + escapeHtml(d.journal || "雑誌名情報なし") + "）";
    return (
    '<div class="fav-item">' +
      '<div class="fav-row">' +
        '<button class="fav-title" data-id="' + d.id + '" title="' + tip + '">' + escapeHtml(d.title) + "</button>" +
        (d.pmid ? '<button data-pmid="' + d.pmid + '" class="pubmed" title="PubMedを開く">PM</button>' : "") +
        '<button data-id="' + d.id + '" class="del" title="削除">✕</button>' +
      "</div>" +
      '<div class="fav-menu" data-id="' + d.id + '" hidden>' +
        '<button class="fav-menu-doi" data-id="' + d.id + '">DOIをコピー</button>' +
        '<button class="fav-menu-open" data-id="' + d.id + '">新しいタブでネットワークを開く</button>' +
      "</div>" +
    "</div>");
  }).join("");

  box.querySelectorAll(".fav-title").forEach(btn => btn.addEventListener("click", () => {
    const menu = box.querySelector('.fav-menu[data-id="' + btn.dataset.id + '"]');
    const wasOpen = !menu.hidden;
    box.querySelectorAll(".fav-menu").forEach(m => { m.hidden = true; });
    menu.hidden = wasOpen;
  }));
  box.querySelectorAll(".fav-menu-doi").forEach(b => b.addEventListener("click", async () => {
    const d = favorites.get(b.dataset.id);
    if (!d || !d.doi) { openModal("DOIをコピー", "この論文にはDOIが登録されていません。", null, "閉じる"); return; }
    const ok = await copyText(d.doi);
    openModal("DOIをコピー", ok ? "DOIをコピーしました。\n\n" + d.doi : "コピーできませんでした。\n\n" + d.doi, null, "閉じる");
  }));
  box.querySelectorAll(".fav-menu-open").forEach(b => b.addEventListener("click", () => {
    const d = favorites.get(b.dataset.id);
    if (d) openNetworkInNewTab(d);
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


/* ============ エコーロケーション ============ */
const ECHO_HOP1_CAP_REFS = 60;   // 2階層目を「引用」でたどる方向：1階層目の上限
const ECHO_HOP1_CAP_CITE = 20;   // 2階層目を「被引用」でたどる方向：1階層目の上限（各々API1回のため小さめ）
const ECHO_PERHOP_CITE = 40;     // 被引用方向で各1階層目論文から取る上限
const ECHO_MAX_FETCH = 600;      // 2階層目候補の取得上限（API負荷の歯止め）
let echoTarget = null;

function openEchoDialog(p) {
  echoTarget = p;
  // 兄弟方向（過去→未来・未来→過去）のときだけ共通度を出す
  syncEchoCommonVisibility();
  document.getElementById("echo-bg").classList.add("open");
}
function syncEchoCommonVisibility() {
  const dir = document.querySelector('input[name="echo-dir"]:checked').value;
  const sibling = (dir === "pf" || dir === "fp");
  document.getElementById("echo-common-wrap").hidden = !sibling;
  document.getElementById("echo-common-note").hidden = !sibling;
}
document.querySelectorAll('input[name="echo-dir"]').forEach(r =>
  r.addEventListener("change", syncEchoCommonVisibility));
document.getElementById("echo-cancel").addEventListener("click", () =>
  document.getElementById("echo-bg").classList.remove("open"));
document.getElementById("echo-bg").addEventListener("click", e => {
  if (e.target === document.getElementById("echo-bg")) e.currentTarget.classList.remove("open");
});
document.getElementById("echo-run").addEventListener("click", () => {
  const dir = document.querySelector('input[name="echo-dir"]:checked').value;
  const typeSet = new Set();
  document.querySelectorAll(".echo-type").forEach(c => { if (c.checked) typeSet.add(c.value); });
  const citesFloor = parseInt(document.getElementById("echo-cites").value, 10);
  const commonFloor = (dir === "pf" || dir === "fp")
    ? parseInt(document.getElementById("echo-common").value, 10) : 1;
  document.getElementById("echo-bg").classList.remove("open");
  if (!typeSet.size) {
    openModal("エコーロケーション", "研究タイプが1つも選ばれていません。1つ以上選んでください。", null, "閉じる");
    return;
  }
  runEcholocation(echoTarget, dir, typeSet, citesFloor, commonFloor);
});

async function runEcholocation(p, dir, typeSet, citesFloor, commonFloor) {
  if (busy) return;
  busy = true;
  try {
    const firstIsPast = (dir === "pp" || dir === "pf");   // 1階層目＝引用文献
    const secondIsPast = (dir === "pp" || dir === "fp");  // 2階層目＝引用（refs）／それ以外は被引用（citers）

    /* ---- 1階層目 ---- */
    setLoading("エコーロケーション：1階層目を取得しています…");
    let hop1 = [];
    if (firstIsPast) {
      const refs = p.referencedWorks || [];
      if (!refs.length) { setLoading(null); busy = false;
        openModal("エコーロケーション", "この論文には引用文献が登録されていないため、この方向はたどれません。", null, "閉じる"); return; }
      const works = await echoFetchByIds(refs);
      hop1 = works.sort((a, b) => (b.cites || 0) - (a.cites || 0)).slice(0, ECHO_HOP1_CAP_REFS);
    } else {
      const res = await fetchFuturePapers(p.id, ECHO_HOP1_CAP_CITE);
      if (!res.papers.length) { setLoading(null); busy = false;
        openModal("エコーロケーション", "この論文を引用した論文がまだ登録されていないため、この方向はたどれません。", null, "閉じる"); return; }
      hop1 = res.papers;
    }

    /* ---- 2階層目（共通度カウント付き） ---- */
    const tally = new Map();  // id -> {paper|null, count, id}
    const bump = (id, paper) => {
      const cur = tally.get(id) || { id: id, paper: null, count: 0 };
      cur.count += 1;
      if (paper && !cur.paper) cur.paper = paper;
      tally.set(id, cur);
    };

    if (secondIsPast) {
      // 各1階層目論文の referencedWorks を集計
      for (const b of hop1) {
        for (const rid of (b.referencedWorks || [])) {
          if (rid === p.id) continue;
          bump(rid, null);
        }
      }
      setLoading("エコーロケーション：引用の引用を取得しています…");
      // API負荷を抑えるため、多くの論文から共通して指されている候補を優先して上限内で取得
      const ranked = [...tally.entries()].sort((a, b) => b[1].count - a[1].count);
      const ids = ranked.slice(0, ECHO_MAX_FETCH).map(x => x[0]);
      const works = await echoFetchByIds(ids);
      const byId = new Map(works.map(w => [w.id, w]));
      for (const [id, entry] of tally) { entry.paper = byId.get(id) || null; }
    } else {
      // 各1階層目論文の被引用（citers）を取得
      let i = 0;
      for (const b of hop1) {
        i++;
        setLoading("エコーロケーション：引用の引用を取得しています…（" + i + "/" + hop1.length + "）");
        try {
          const res = await fetchFuturePapers(b.id, ECHO_PERHOP_CITE);
          for (const cp of res.papers) {
            if (cp.id === p.id) continue;
            bump(cp.id, cp);
          }
        } catch (e) { /* 個別失敗はスキップ */ }
      }
    }

    /* ---- 絞り込み ---- */
    const sibling = (dir === "pf" || dir === "fp");
    let candidates = [...tally.values()].filter(e => e.paper);
    candidates = candidates.filter(e =>
      typeSet.has(e.paper.study || "OTHER") &&
      (e.paper.cites || 0) >= citesFloor &&
      (!sibling || e.count >= commonFloor)
    );
    // 既存ノード・起点は除外（新規のみ追加）
    const fresh = candidates.filter(e => !Graph.papers.has(e.id) && e.id !== p.id);

    setLoading(null);

    if (!fresh.length) {
      openModal("エコーロケーション",
        "条件に合う「引用の引用」は見つかりませんでした。\n研究タイプを増やす、被引用数の下限を下げる" +
        (sibling ? "、共通度の下限を下げる" : "") + "、などで再度お試しください。", null, "閉じる");
      busy = false; return;
    }

    // 追加数の歯止め（既存の確認ダイアログ＆上限チェックを再利用）
    const warn = capCheck(fresh.length);
    if (warn === null) { busy = false; return; }
    const dirName = { pp: "過去→過去", ff: "未来→未来", pf: "過去→未来", fp: "未来→過去" }[dir];
    const msg = "方向：" + dirName + "\n条件に合う「引用の引用」が " + fresh.length + " 件見つかりました。\n" +
      "これらを新しい層（外周リング付き）として追加します。\n続行しますか？" + warn;
    openModal("エコーロケーション", msg, async () => {
      const newOnes = fresh.map(e => { e.paper.echo = true; e.paper.rel = "expanded"; return e.paper; });
      setLoading("PubMedから研究種別を取得しています…");
      try { await enrichStudyTypes(newOnes); } catch (e) { /* 補助情報 */ }
      setLoading(null);
      Graph.addPapers(newOnes, new Set(favorites.keys()), new Set(pfSelection));
    });
  } catch (e) {
    setLoading(null);
    openModal("エラー", apiErrorMessage(e), null, "閉じる");
  } finally {
    setLoading(null);
    busy = false;
  }
}

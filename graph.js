/* graph.js — ネットワーク図の生成と操作（Cytoscape.js） */

const COLORS = {
  direction: { root: "#BF3B3B", past: "#3E6FA3", future: "#D98E32", both: "#8A5FA8", expanded: "#8A97A0" },
  era: [
    ["1989年以前", -Infinity, 1989, "#8C6BB1"],
    ["1990年代", 1990, 1999, "#4477AA"],
    ["2000年代", 2000, 2009, "#228833"],
    ["2010年代", 2010, 2019, "#CCBB44"],
    ["2020年代", 2020, 2029, "#EE6677"],
    ["出版年不明", null, null, "#BBBBBB"]
  ]
};
const SHAPES = { RCT: "diamond", META: "hexagon", REVIEW: "round-rectangle", OBS: "round-triangle", GUIDE: "star", CASE: "tag", OTHER: "ellipse" };
const STUDY_LABEL = { RCT: "RCT", META: "メタ解析・SR", REVIEW: "レビュー", OBS: "観察研究", GUIDE: "ガイドライン", CASE: "症例報告", OTHER: "種別未判定" };

/* 重要度（被引用数）の色と閾値プリセット（濃い→薄い） */
const IMP_COLORS = ["#0F5F5B", "#338782", "#63AFA9", "#9CCFCB", "#CFE8E6"];
const IMP_PRESETS = {
  low:    [300, 100, 30, 10],
  normal: [1000, 500, 100, 10],
  high:   [5000, 1000, 500, 100]
};
const REL_LABEL = { root: "起点論文", past: "引用文献（過去）", future: "被引用文献（未来）", both: "引用・被引用の両方", expanded: "追加文献" };

/* Canvas用：文字列を折り返して描画（maxLines行で省略） */
function chmWrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  let line = "", lines = 0;
  for (const ch of String(text)) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(lines === maxLines - 1 ? line.slice(0, -1) + "…" : line, x, y + lines * lineHeight);
      lines++;
      if (lines >= maxLines) return;
      line = ch;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

const Graph = {
  cy: null,
  papers: new Map(),        // id -> paper
  rootId: null,
  colorMode: "direction",
  callbacks: {},

  /* ---------- 初期化 ---------- */
  init(callbacks) {
    this.callbacks = callbacks || {};
    this.cy = cytoscape({
      container: document.getElementById("cy"),
      elements: [],
      style: [
        { selector: "node", style: {
          "shape": e => SHAPES[e.data("study")] || "ellipse",
          "width": e => this.nodeSize(e.data("cites"), e.data("study")),
          "height": e => this.nodeSize(e.data("cites"), e.data("study")),
          "background-color": e => this.nodeColor(e.data()),
          "border-width": e => e.data("rel") === "root" ? 4 : 1.5,
          "border-color": e => e.data("rel") === "root" ? "#7A1F1F" : "#FFFFFF",
          "label": "data(label)",
          "font-size": "10px", "color": "#1C2B33",
          "text-wrap": "wrap", "text-max-width": "130px",
          "text-valign": "bottom", "text-margin-y": "5px",
          "text-background-color": "#F3F6F8", "text-background-opacity": 0.75,
          "text-background-padding": "2px"
        }},
        { selector: "node[rel='root']", style: { "z-index": 10 } },
        { selector: "edge", style: {
          "width": 1.4, "line-color": "#B9C6CE", "opacity": 0.3,
          "target-arrow-shape": "triangle", "target-arrow-color": "#B9C6CE",
          "curve-style": "bezier", "arrow-scale": 0.9
        }},
        { selector: "node.nolabel", style: { "text-opacity": 0, "text-background-opacity": 0 } },
        { selector: "node.nolabel:selected", style: { "text-opacity": 1, "text-background-opacity": 0.75 } },
        { selector: "node:selected", style: { "border-width": 4, "border-color": "#0E6E6E" } },
        { selector: ".dim", style: { "opacity": 0.18 } },
        { selector: "edge.hl", style: { "opacity": 1, "line-color": "#0E6E6E", "target-arrow-color": "#0E6E6E", "width": 2.4 } },
        { selector: "edge.hovhl", style: { "opacity": 1, "line-color": "#5E7280", "target-arrow-color": "#5E7280", "width": 2 } },
        { selector: "node.hit", style: { "border-width": 4, "border-color": "#E0A426" } },
        { selector: "node.dirhidden, node.clustered", style: { "display": "none" } },
        { selector: "node[?isCluster]", style: {
          "shape": "round-rectangle", "background-color": "#E8EDF0",
          "border-style": "dashed", "border-color": "#8A97A0", "border-width": 1.5,
          "width": 66, "height": 30, "text-valign": "center", "text-margin-y": 0,
          "font-size": "10px", "text-background-opacity": 0, "text-opacity": 1
        }},
        { selector: "node.nolabel[?isCluster]", style: { "text-opacity": 1 } }
      ],
      wheelSensitivity: 0.25
    });

    this.cy.on("tap", "node", evt => {
      const n = evt.target;
      if (n.data("isCluster")) { this.expandClusterByNode(n); return; }
      this.highlightNeighborhood(n);
      if (this.callbacks.onSelect) this.callbacks.onSelect(this.papers.get(n.id()));
    });
    this.cy.on("tap", evt => {
      if (evt.target === this.cy) {
        this.clearHighlight();
        if (this.callbacks.onBackground) this.callbacks.onBackground();
      }
    });
    this.cy.on("pan zoom", () => this.updateRuler());
    this.cy.on("zoom", () => this.updateLabelVisibility());
    // マウスオーバーで、ズームに関係なく読める大きさのツールチップを表示
    const tip = document.getElementById("cy-tip");
    this.cy.on("mouseover", "node", evt => {
      const n = evt.target;
      if (n.data("isCluster")) {
        const info = this._clusters.get(n.id());
        const y = (info && info.key !== "unknown") ? info.key + "年の" : "";
        tip.textContent = y + "下位論文" + (info ? info.memberIds.length : "") + "件を畳んでいます（タップで展開）";
        tip.style.display = "block";
        return;
      }
      const p = this.papers.get(n.id());
      if (!p) return;
      tip.textContent = (p.year != null ? p.year + "年｜" : "") + p.title;
      tip.style.display = "block";
      n.connectedEdges().addClass("hovhl");
    });
    this.cy.on("mousemove", "node", evt => {
      const r = evt.renderedPosition;
      if (!r) return;
      const wrap = document.getElementById("cy-wrap");
      const x = Math.min(r.x + 16, wrap.clientWidth - 350);
      tip.style.left = Math.max(4, x) + "px";
      tip.style.top = (r.y + 12) + "px";
    });
    this.cy.on("mouseout", "node", () => {
      tip.style.display = "none";
      this.cy.edges().removeClass("hovhl");
    });
    this.cy.on("tap", "node", () => { tip.style.display = "none"; });
    window.addEventListener("resize", () => this.updateRuler());
  },

  /* ズームアウト時はラベルを隠し、拡大時に表示する */
  updateLabelVisibility() {
    const show = this.cy.zoom() >= 0.6;
    this.cy.nodes().toggleClass("nolabel", !show);
  },

  /* ---------- 見た目の計算 ---------- */
  /* ノードの大きさ：被引用数の対数スケール。傾斜は3段階から選択。
     「その他・未判定」は一回り小さく表示する。 */
  sizeMode: "normal",
  _sizeParams: {
    soft:   { base: 9, k: 8,  min: 15, max: 34 },
    normal: { base: 8, k: 12, min: 16, max: 44 },
    strong: { base: 5, k: 19, min: 13, max: 60 }
  },
  nodeSize(c, study) {
    const p = this._sizeParams[this.sizeMode] || this._sizeParams.normal;
    let s = Math.max(p.min, Math.min(p.max, p.base + Math.log10((c || 0) + 1) * p.k));
    if (study === "OTHER") s = Math.max(12, s * 0.65);
    return s;
  },
  setSizeMode(mode) {
    this.sizeMode = mode;
    this.cy.style().update();
  },
  eraColor(y) {
    if (y == null) return "#BBBBBB";
    for (const [, a, b, c] of COLORS.era) { if (a !== null && y >= a && y <= b) return c; }
    return "#BBBBBB";
  },
  impPreset: "normal",
  setImpPreset(p) { this.impPreset = p; this.refreshColors(); },
  impColor(c) {
    const t = IMP_PRESETS[this.impPreset] || IMP_PRESETS.normal;
    const v = c || 0;
    for (let i = 0; i < t.length; i++) { if (v >= t[i]) return IMP_COLORS[i]; }
    return IMP_COLORS[IMP_COLORS.length - 1];
  },
  nodeColor(d) {
    if (this.colorMode === "direction") return COLORS.direction[d.rel] || COLORS.direction.expanded;
    if (this.colorMode === "era") return this.eraColor(d.year);
    if (this.colorMode === "importance") return this.impColor(d.cites);
    return COLORS.direction[d.rel] || COLORS.direction.expanded;
  },
  shortTitle(t) { return t.length > 34 ? t.slice(0, 34) + "…" : t; },
  labelFor(p, isFav) { return this.shortTitle(p.title) + (isFav ? " ★" : ""); },

  /* ---------- ネットワーク構築 ---------- */
  build(root, past, future, favIds) {
    this.papers.clear();
    this.cy.elements().remove();
    this.rootId = root.id;

    const pastIds = new Set(past.map(p => p.id));
    const all = [root];
    for (const p of past) { if (p.id !== root.id) all.push(p); }
    for (const f of future) {
      if (f.id === root.id) continue;
      if (pastIds.has(f.id)) {
        const existing = all.find(p => p.id === f.id);
        if (existing) existing.rel = "both";
      } else {
        all.push(f);
      }
    }
    this.addPapersInternal(all, favIds);
    this.computeEdges();
    this.applyDirFilter();
    this.applyClustering();
    this.refreshColors();
    this.runLayout();
  },

  /* 追加（重複はスキップ）。戻り値: 追加された件数 */
  addPapers(papers, favIds) {
    const fresh = papers.filter(p => !this.papers.has(p.id));
    this.addPapersInternal(fresh, favIds);
    this.computeEdges();
    this.applyDirFilter();
    this.applyClustering();
    this.refreshColors();
    this.runLayout();
    return fresh.length;
  },

  addPapersInternal(papers, favIds) {
    if (favIds) this.favIds = favIds;
    const favs = favIds || new Set();
    const eles = papers.map(p => {
      this.papers.set(p.id, p);
      return { data: {
        id: p.id, label: this.labelFor(p, favs.has(p.id)),
        rel: p.rel, study: p.study, cites: p.cites, year: p.year, title: p.title
      }};
    });
    this.cy.add(eles);
  },

  /* referencedWorks を突き合わせてエッジを生成（表示中ノード同士の引用も含む） */
  computeEdges() {
    const newEdges = [];
    for (const p of this.papers.values()) {
      for (const rid of p.referencedWorks) {
        if (!this.papers.has(rid) || rid === p.id) continue;
        const eid = p.id + "__" + rid;
        if (this.cy.getElementById(eid).length === 0) {
          newEdges.push({ data: { id: eid, source: p.id, target: rid } });
        }
      }
    }
    if (newEdges.length) this.cy.add(newEdges);
  },

  nodeCount() { return this.cy.nodes().length; },

  /* ---------- 表示対象（過去のみ／未来のみ／両方） ---------- */
  dirFilter: "both",
  setDirectionFilter(mode) {
    this.dirFilter = mode;
    this.applyDirFilter();
    this.applyClustering();
    this.refreshColors();
    this.runLayout();
  },
  applyDirFilter() {
    this.cy.nodes().forEach(n => {
      if (n.data("isCluster")) return;
      const rel = n.data("rel");
      let hide = false;
      if (this.dirFilter === "past") hide = (rel === "future");
      else if (this.dirFilter === "future") hide = (rel === "past");
      // 起点論文・引用被引用の両方に関係する文献・追加文献は常に表示
      n.toggleClass("dirhidden", hide);
    });
  },
  visibleNodes() {
    return this.cy.nodes().filter(n => n.style("display") !== "none");
  },

  /* ---------- 年クラスタの折りたたみ ----------
     同じ年の論文が多い場合、被引用数上位KEEP_TOP件・起点論文・
     過去未来両方の文献・お気に入りは個別表示のまま、
     残りが MIN_COLLAPSE 件以上あれば「ほか○件」ノードに畳む。 */
  clusterEnabled: true,
  KEEP_TOP: 8,
  MIN_COLLAPSE: 3,
  setKeepTop(n) {
    this.KEEP_TOP = n;
    this.applyClustering();
    this.refreshColors();
    this.runLayout();
  },
  favIds: new Set(),
  _clusters: new Map(),   // clusterId -> {key, memberIds}
  setClusterEnabled(on) {
    this.clusterEnabled = on;
    this.applyClustering();
    this.refreshColors();
    this.runLayout();
  },
  clearClustering() {
    this.cy.nodes(".clustered").removeClass("clustered");
    this.cy.nodes("[?isCluster]").remove();
    this._clusters.clear();
  },
  applyClustering() {
    this.clearClustering();
    if (!this.clusterEnabled) return;
    const groups = new Map();
    this.cy.nodes().forEach(n => {
      if (n.data("isCluster") || n.hasClass("dirhidden")) return;
      const rel = n.data("rel");
      if (rel === "root" || rel === "both") return;
      if (this.favIds.has(n.id())) return;
      const key = (n.data("year") == null) ? "unknown" : n.data("year");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    const newNodes = [];
    for (const [key, nodes] of groups) {
      nodes.sort((a, b) => (b.data("cites") || 0) - (a.data("cites") || 0));
      const rest = nodes.slice(this.KEEP_TOP);
      if (rest.length < this.MIN_COLLAPSE) continue;
      rest.forEach(n => n.addClass("clustered"));
      const cid = "cluster_" + key;
      this._clusters.set(cid, { key: key, memberIds: rest.map(n => n.id()) });
      newNodes.push({ data: {
        id: cid, isCluster: 1, label: "ほか" + rest.length + "件",
        year: (key === "unknown") ? null : key, rel: "cluster", cites: 0, title: ""
      }});
    }
    if (newNodes.length) this.cy.add(newNodes);
  },
  expandClusterByNode(n) {
    const info = this._clusters.get(n.id());
    if (!info) return;
    info.memberIds.forEach(id => this.cy.getElementById(id).removeClass("clustered"));
    this._clusters.delete(n.id());
    n.remove();
    this.refreshColors();
    this.runLayout();
  },

  /* ---------- レイアウト（タイムライン一本） ---------- */
  yearRange() {
    let min = Infinity, max = -Infinity;
    for (const p of this.papers.values()) {
      if (p.year != null) { min = Math.min(min, p.year); max = Math.max(max, p.year); }
    }
    if (!isFinite(min)) { min = 1990; max = 2030; }
    return { min: min, max: max };
  },

  /* 年ごとの「列」方式タイムライン。
     年の間隔は等幅（時間の距離感より視認性を優先）。
     同じ年の論文は重ならない間隔で縦に積み、多い年は自動でサブ列に分割する。 */
  _cols: [],
  timelinePositions() {
    const COLW = 130;   // 年の列の幅
    const SUBW = 60;    // サブ列のずらし幅
    const VSP = 85;     // 縦の間隔（ノード最大径＋ラベル分）
    const PER_COL = 9;  // 1列に積む最大数

    const visible = this.visibleNodes();
    const years = [...new Set(
      visible.map(n => n.data("year")).filter(y => y != null)
    )].sort((a, b) => a - b);
    const xOf = {};
    years.forEach((y, i) => { xOf[y] = i * COLW; });
    const unknownX = years.length * COLW;
    this._cols = years.map((y, i) => ({
      label: String(y),
      x: xOf[y],
      gapBefore: (i > 0 && y - years[i - 1] > 1) ? (y - years[i - 1] - 1) : 0
    }));
    if (visible.some(n => n.data("year") == null)) {
      this._cols.push({ label: "年不明", x: unknownX });
    }

    const groups = new Map();
    visible.forEach(n => {
      const y = n.data("year");
      const key = (y == null) ? "unknown" : y;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });

    const pos = {};
    for (const [key, nodes] of groups) {
      nodes.sort((a, b) => {
        if (a.data("rel") === "root") return -1;
        if (b.data("rel") === "root") return 1;
        return (b.data("cites") || 0) - (a.data("cites") || 0);
      });
      const baseX = (key === "unknown") ? unknownX : xOf[key];
      nodes.forEach((n, i) => {
        const sub = Math.floor(i / PER_COL);
        const j = i % PER_COL;
        // 0, +1, -1, +2, -2… と中央から交互に積む（起点論文は必ず中央）
        const step = Math.ceil(j / 2) * (j % 2 === 1 ? 1 : -1);
        pos[n.id()] = {
          x: baseX + sub * SUBW,
          y: step * VSP + (sub % 2) * (VSP / 2)
        };
      });
    }
    return pos;
  },
  runLayout() {
    this.cy.layout({ name: "preset", positions: this.timelinePositions(),
      animate: true, animationDuration: 350, fit: true, padding: 40 }).run();
    this.updateRuler();
    this.updateLabelVisibility();
    setTimeout(() => this.updateLabelVisibility(), 450); // レイアウトのアニメーション完了後にも再判定
  },
  fit() { this.cy.fit(undefined, 40); },

  /* ---------- タイムライン年目盛（各列の年を表示） ---------- */
  updateRuler() {
    const ruler = document.getElementById("ruler");
    if (this.papers.size === 0 || !this._cols.length) {
      ruler.style.display = "none"; return;
    }
    ruler.style.display = "block";
    const zoom = this.cy.zoom(), pan = this.cy.pan();
    // 列の表示幅が狭いときはラベルを間引く
    const colPx = 130 * zoom;
    const every = colPx >= 45 ? 1 : (colPx >= 24 ? 2 : 4);
    let html = "";
    this._cols.forEach((c, i) => {
      const rx = c.x * zoom + pan.x;
      if (c.gapBefore > 0) {
        const gx = (c.x - 65) * zoom + pan.x; // 前の列との中間
        if (gx > -80 && gx < ruler.clientWidth + 80 && colPx >= 24) {
          html += '<div class="tick gap" style="left:' + gx + 'px">⋯' + c.gapBefore + "年⋯</div>";
        }
      }
      if (rx > -80 && rx < ruler.clientWidth + 80) {
        const lab = (i % every === 0) ? c.label : "";
        html += '<div class="tick" style="left:' + rx + 'px">' + lab + "</div>";
      }
    });
    html += '<div class="tick caption">← 過去　｜　未来 →</div>';
    ruler.innerHTML = html;
  },

  /* ---------- 色・凡例 ---------- */
  legendVisible: true,
  setLegendVisible(on) {
    this.legendVisible = on;
    document.getElementById("legend").hidden = !on;
  },
  setColorMode(mode) { this.colorMode = mode; this.refreshColors(); },
  refreshColors() {
    this.cy.nodes().forEach(n => n.style("background-color", this.nodeColor(n.data())));
    this.renderLegend();
  },
  renderLegend() {
    const legend = document.getElementById("legend");
    let rows = "";
    if (this.colorMode === "direction") {
      for (const k of ["root", "past", "future", "both", "expanded"]) {
        rows += '<div class="lg-row"><span class="sw" style="background:' + COLORS.direction[k] + '"></span>' + REL_LABEL[k] + "</div>";
      }
    } else if (this.colorMode === "era") {
      for (const [lab, , , c] of COLORS.era) {
        rows += '<div class="lg-row"><span class="sw" style="background:' + c + '"></span>' + lab + "</div>";
      }
    } else if (this.colorMode === "importance") {
      const t = IMP_PRESETS[this.impPreset] || IMP_PRESETS.normal;
      const labs = [
        t[0].toLocaleString() + "回以上",
        t[1].toLocaleString() + "〜" + (t[0] - 1).toLocaleString() + "回",
        t[2].toLocaleString() + "〜" + (t[1] - 1).toLocaleString() + "回",
        t[3].toLocaleString() + "〜" + (t[2] - 1).toLocaleString() + "回",
        "0〜" + (t[3] - 1).toLocaleString() + "回"
      ];
      rows += '<div class="lg-row" style="color:var(--sub)">被引用数</div>';
      labs.forEach((lab, i) => {
        rows += '<div class="lg-row"><span class="sw" style="background:' + IMP_COLORS[i] + '"></span>' + lab + "</div>";
      });
    }
    const shapes =
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><polygon points="7,1 13,7 7,13 1,7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>RCT</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><polygon points="7,1 12.5,4 12.5,10 7,13 1.5,10 1.5,4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>メタ解析・SR</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><rect x="1.5" y="3" width="11" height="8" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>レビュー</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><polygon points="7,1.5 13,12.5 1,12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>観察研究</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><polygon points="7,0.8 8.8,5.1 13.2,5.3 9.8,8.1 11,12.6 7,10.1 3,12.6 4.2,8.1 0.8,5.3 5.2,5.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>ガイドライン</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><polygon points="1,3.5 9.5,3.5 13,7 9.5,10.5 1,10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>症例報告</div>' +
      '<div class="lg-row"><svg class="shape" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>その他・未判定</div>';
    const colorName = { direction: "引用方向", era: "出版年代", importance: "重要度（被引用数）" }[this.colorMode];
    legend.innerHTML = "<h3>色：" + colorName + "</h3>" + rows +
      "<h3>形：研究の種類（PubMed分類／なければタイトルから暫定）</h3>" + shapes +
      '<div class="arrow-note">矢印の先が、引用された論文です。<br>ノードの大きさ＝被引用数<br>点線の枠「ほか○件」＝畳まれた同年の下位論文（タップで展開）<br>線はノードに触れる・選択すると強調表示されます</div>';
    legend.hidden = !this.legendVisible;
  },

  /* ---------- 強調・選択 ---------- */
  highlightNeighborhood(n) {
    this.clearHighlight();
    const hood = n.closedNeighborhood();
    this.cy.elements().not(hood).addClass("dim");
    n.connectedEdges().addClass("hl");
  },
  clearHighlight() {
    this.cy.elements().removeClass("dim");
    this.cy.edges().removeClass("hl");
    this.cy.nodes().removeClass("hit");
  },
  centerOn(id) {
    let n = this.cy.getElementById(id);
    if (!n.length) return;
    if (n.hasClass("clustered")) {
      for (const [cid, info] of this._clusters) {
        if (info.memberIds.includes(id)) {
          this.expandClusterByNode(this.cy.getElementById(cid));
          break;
        }
      }
      n = this.cy.getElementById(id);
    }
    this.cy.animate({ center: { eles: n }, zoom: Math.max(this.cy.zoom(), 1.1), duration: 300 });
    n.emit("tap");
  },

  /* ---------- 検索 ---------- */
  search(q) {
    this.cy.nodes().removeClass("hit");
    this.cy.elements().removeClass("dim");
    if (!q) return 0;
    const lower = q.toLowerCase();
    const hits = this.cy.nodes().filter(n => (n.data("title") || "").toLowerCase().includes(lower));
    if (hits.length) {
      this.cy.nodes().not(hits).addClass("dim");
      hits.addClass("hit");
    }
    return hits.length;
  },

  /* ---------- 上位リスト ---------- */
  /* 戻り値: [{paper, metric}] 上位n件 */
  rankPapers(crit, n) {
    const okIds = new Set(
      this.cy.nodes()
        .filter(el => !el.hasClass("dirhidden") && !el.data("isCluster"))
        .map(el => el.id())
    );
    const arr = [...this.papers.values()].filter(p => okIds.has(p.id));
    if (!arr.length) return [];
    if (crit === "hub") {
      return arr
        .map(p => ({ paper: p, d: this.cy.getElementById(p.id).degree(false) }))
        .sort((a, b) => b.d - a.d)
        .slice(0, n)
        .map(x => ({ paper: x.paper, metric: "表示中の接続数 " + x.d }));
    }
    if (crit === "old" || crit === "new") {
      const dated = arr.filter(p => p.year != null);
      dated.sort((a, b) => crit === "old" ? a.year - b.year : b.year - a.year);
      return dated.slice(0, n).map(p => ({ paper: p, metric: p.year + "年" }));
    }
    // 既定：被引用数順
    return arr
      .sort((a, b) => (b.cites || 0) - (a.cites || 0))
      .slice(0, n)
      .map(p => ({ paper: p, metric: "被引用数 " + (p.cites != null ? p.cites.toLocaleString() : "不明") + "回" }));
  },

  /* ---------- PNG出力 ----------
     グラフ本体に加えて、起点論文タイトル・作成日・データ出典のヘッダーと
     タイムラインの年目盛りを焼き込み、単体で資料に貼れる図版として書き出す。
     出力時のみノードのタイトルを60文字まで表示する。 */
  exportPng() {
    return new Promise(resolve => {
      const nodes = this.cy.nodes();
      nodes.removeClass("nolabel");
      const orig = new Map();
      nodes.forEach(n => {
        if (n.data("isCluster")) return;
        const p = this.papers.get(n.id());
        if (!p) return;
        orig.set(n.id(), n.data("label"));
        const t = p.title.length > 60 ? p.title.slice(0, 60) + "…" : p.title;
        n.data("label", t + (this.favIds.has(p.id) ? " ★" : ""));
      });
      const bb = this.cy.elements().boundingBox();
      const scale = 2;
      const uri = this.cy.png({ full: true, scale: scale, bg: "#F3F6F8", maxWidth: 8000, maxHeight: 8000 });
      orig.forEach((lab, id) => this.cy.getElementById(id).data("label", lab));
      this.updateLabelVisibility();

      const img = new Image();
      img.onload = () => {
        const mL = 50, mR = 50, mT = 130;
        const showAxis = (this._cols.length > 0);
        const mB = showAxis ? 80 : 40;
        const c = document.createElement("canvas");
        c.width = img.width + mL + mR;
        c.height = img.height + mT + mB;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#F3F6F8";
        ctx.fillRect(0, 0, c.width, c.height);

        const rootP = this.papers.get(this.rootId);
        ctx.fillStyle = "#1C2B33";
        ctx.font = "bold 28px sans-serif";
        chmWrapText(ctx, rootP ? rootP.title : "", mL, 48, c.width - mL - mR, 36, 2);
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#5B6B77";
        const today = new Date().toISOString().slice(0, 10);
        ctx.fillText("Citation History Map ｜ 作成日 " + today + " ｜ データ: OpenAlex / PubMed", mL, mT - 16);

        ctx.drawImage(img, mL, mT);

        if (showAxis) {
          ctx.strokeStyle = "#9AA7B0";
          ctx.fillStyle = "#5B6B77";
          ctx.textAlign = "center";
          const axisY = mT + img.height + 8;
          for (const col of this._cols) {
            const x = mL + (col.x - bb.x1) * scale;
            if (x < mL - 30 || x > c.width - mR + 30) continue;
            ctx.font = "15px sans-serif";
            ctx.beginPath();
            ctx.moveTo(x, axisY);
            ctx.lineTo(x, axisY + 10);
            ctx.stroke();
            ctx.fillText(col.label, x, axisY + 30);
            if (col.gapBefore > 0) {
              const gx = mL + (col.x - 65 - bb.x1) * scale;
              ctx.font = "13px sans-serif";
              ctx.fillText("⋯" + col.gapBefore + "年⋯", gx, axisY + 30);
            }
          }
          ctx.textAlign = "left";
        }
        resolve(c.toDataURL("image/png"));
      };
      img.src = uri;
    });
  },

  /* ---------- お気に入り表示 ---------- */
  updateFavStar(id, on) {
    if (on) this.favIds.add(id); else this.favIds.delete(id);
    const n = this.cy.getElementById(id);
    if (!n.length) return;
    const p = this.papers.get(id);
    n.data("label", this.labelFor(p, on));
  }
};

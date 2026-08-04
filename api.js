/* api.js — 入力の正規化と OpenAlex API からのデータ取得 */

const API_BASE = "https://api.openalex.org";
const SELECT_FIELDS = [
  "id", "display_name", "authorships", "publication_year", "publication_date",
  "primary_location", "doi", "ids", "cited_by_count", "referenced_works", "type"
].join(",");

/* ============ 入力の正規化 ============ */
/* 戻り値: {type:"doi"|"pmid", value} または {error:"メッセージ"} */
function normalizeInput(raw) {
  const s = (raw || "").trim();
  if (!s) return { error: "DOIまたはPMIDを入力してください。" };
  if (s.length > 300) return { error: "入力が長すぎます。DOIまたはPMIDのみを入力してください。" };

  // DOI URL（https://doi.org/... , dx.doi.org）
  let m = s.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\..+)$/i);
  if (m) return { type: "doi", value: decodeURIComponent(m[1]) };

  // doi: プレフィックス
  m = s.match(/^doi:\s*(10\..+)$/i);
  if (m) return { type: "doi", value: m[1].trim() };

  // DOI文字列（10.で始まる）
  if (/^10\.\S+\/\S+/.test(s)) return { type: "doi", value: s };

  // PubMed URL
  m = s.match(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?/i);
  if (m) return { type: "pmid", value: m[1] };

  // PMID: プレフィックス
  m = s.match(/^pmid:?\s*(\d+)$/i);
  if (m) return { type: "pmid", value: m[1] };

  // 数字のみ
  if (/^\d{1,9}$/.test(s)) return { type: "pmid", value: s };

  if (/^https?:\/\//i.test(s)) {
    return { error: "このURLの形式には対応していません。DOIのURL（doi.org）またはPubMedのURLを入力してください。" };
  }
  return { error: "DOIまたはPMIDとして認識できませんでした。入力例を参考に、もう一度お試しください。" };
}

/* ============ 共通GET ============ */
class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

async function apiGet(path, params) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const key = getApiKey();
  if (key) url.searchParams.set("api_key", key);

  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    throw new ApiError("network");
  }
  if (res.status === 404) throw new ApiError("notfound", 404);
  if (res.status === 401 || res.status === 403) throw new ApiError("auth", res.status);
  if (res.status === 409 || res.status === 429) throw new ApiError("limit", res.status);
  if (!res.ok) throw new ApiError("other", res.status);

  let json;
  try { json = await res.json(); }
  catch (e) { throw new ApiError("badresponse"); }
  return json;
}

/* ============ OpenAlex応答 → アプリ内の論文オブジェクト ============ */
function shortOAId(u) { return u ? String(u).replace(/^https?:\/\/openalex\.org\//, "") : null; }
function stripDoi(u) { return u ? String(u).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") : null; }
function extractPmid(u) {
  if (!u) return null;
  const m = String(u).match(/(\d+)\s*\/?\s*$/);
  return m ? m[1] : null;
}

/* 研究種別の暫定判定（タイトルとOpenAlexのtypeによるヒューリスティック。
   正式にはフェーズ2で PubMed の Publication Type を使う予定） */
function classifyStudy(w) {
  const t = (w.display_name || "").toLowerCase();
  if (/meta-?analys|systematic review/.test(t)) return "META";
  if (/randomi[sz]ed|randomi[sz]ation/.test(t)) return "RCT";
  if (/cohort|case-?control|cross-?sectional|observational|registry|surveillance|longitudinal|retrospective|prospective|follow-?up study/.test(t)) return "OBS";
  if (/case report|case series/.test(t)) return "CASE";
  if (w.type === "review" || /\breview\b/.test(t)) return "REVIEW";
  return "OTHER";
}

function toPaper(w, rel) {
  return {
    id: shortOAId(w.id),
    title: w.display_name || "（タイトル情報なし）",
    authors: (w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean),
    year: (w.publication_year != null) ? w.publication_year : null,
    journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || null,
    doi: stripDoi(w.doi),
    pmid: extractPmid(w.ids && w.ids.pmid),
    cites: (w.cited_by_count != null) ? w.cited_by_count : null,
    referencedWorks: (w.referenced_works || []).map(shortOAId),
    study: classifyStudy(w),
    studySource: "title",
    rel: rel,
    loadedPast: false,
    loadedFuture: false
  };
}

/* ============ 個別取得 ============ */

/* DOI/PMIDから起点論文を1件取得 */
async function fetchRootWork(norm) {
  const path = norm.type === "doi"
    ? "/works/doi:" + encodeURIComponent(norm.value)
    : "/works/pmid:" + norm.value;
  const w = await apiGet(path, { select: SELECT_FIELDS });
  return toPaper(w, "root");
}

/* OpenAlex IDのリストから書誌情報をまとめて取得（50件ずつのOR構文） */
let ID_FILTER_KEY = "ids.openalex";
async function fetchWorksByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let data;
    try {
      data = await apiGet("/works", {
        filter: ID_FILTER_KEY + ":" + chunk.join("|"),
        "per-page": String(chunk.length),
        select: SELECT_FIELDS
      });
    } catch (e) {
      // フィルター名の違いによる失敗に備えた予備（両表記に対応）
      if (e.code === "other" && ID_FILTER_KEY === "ids.openalex") {
        ID_FILTER_KEY = "openalex_id";
        data = await apiGet("/works", {
          filter: ID_FILTER_KEY + ":" + chunk.join("|"),
          "per-page": String(chunk.length),
          select: SELECT_FIELDS
        });
      } else { throw e; }
    }
    out.push(...(data.results || []));
  }
  return out;
}

/* 未来文献：この論文を引用している論文を被引用数順に上位limit件 */
async function fetchFuturePapers(workId, limit) {
  const data = await apiGet("/works", {
    filter: "cites:" + workId,
    sort: "cited_by_count:desc",
    "per-page": String(limit),
    select: SELECT_FIELDS
  });
  const papers = (data.results || []).map(w => toPaper(w, "future"));
  const total = (data.meta && data.meta.count != null) ? data.meta.count : papers.length;
  return { papers: papers, total: total };
}

/* エコーロケーション用：IDリストから論文を取得して返す（研究種別は暫定＝タイトル判定のまま） */
async function echoFetchByIds(ids) {
  if (!ids.length) return [];
  return (await fetchWorksByIds(ids)).map(w => toPaper(w, "expanded"));
}

/* ============ PubMed Publication Type による研究種別の正式判定 ============
   PMIDを持つ論文について、PubMed公式の文献種別（Publication Type）を取得し、
   タイトルからの暫定判定を上書きする。取得失敗時は暫定判定のまま続行する。 */

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

function classifyFromPubTypes(types) {
  const t = types.map(x => String(x).toLowerCase());
  const has = s => t.some(x => x.includes(s));
  if (has("meta-analysis") || has("systematic review")) return "META";
  if (has("randomized controlled trial")) return "RCT";
  if (has("guideline")) return "GUIDE";          // Practice Guideline / Guideline
  if (has("observational study")) return "OBS";
  if (has("case reports")) return "CASE";
  if (has("review")) return "REVIEW";
  return null;  // "Journal Article"のみ等 → タイトル暫定判定を維持
}

async function fetchPubTypes(pmids) {
  const out = new Map();
  for (let i = 0; i < pmids.length; i += 100) {
    const chunk = pmids.slice(i, i + 100);
    try {
      const res = await fetch(EUTILS_BASE + "?db=pubmed&retmode=json&id=" + chunk.join(","));
      if (!res.ok) continue;
      const data = await res.json();
      const r = data.result || {};
      for (const id of chunk) {
        const rec = r[id];
        if (rec && Array.isArray(rec.pubtype)) {
          const cat = classifyFromPubTypes(rec.pubtype);
          if (cat) out.set(id, cat);
        }
      }
    } catch (e) { /* 分類は補助情報なので、失敗しても処理を止めない */ }
  }
  return out;
}

async function enrichStudyTypes(papers) {
  const withPmid = papers.filter(p => p && p.pmid);
  if (!withPmid.length) return;
  const map = await fetchPubTypes(withPmid.map(p => p.pmid));
  for (const p of withPmid) {
    const cat = map.get(p.pmid);
    if (cat) { p.study = cat; p.studySource = "pubmed"; }
  }
}

/* ============ Europe PMC による研究種別の補助判定（PubMedで確定しなかった論文向け） ============
   PubMedのPublication Typeは、実際のガイドライン等でも「Journal Article」としかタグ付けされて
   いないことが少なくなく、その場合は分類できずタイトル判定のまま残ってしまう。Europe PMCは
   PubMed本体より文献種別のタグ付けが充実している傾向があり、かつDOIのみの論文（PMIDがない）も
   検索できるため、PubMedで解決しなかった論文だけを対象にした補助的な2段目の判定として追加する。
   失敗しても既存の判定（タイトル or PubMed）を維持し、処理は止めない。 */

const EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

function classifyFromEuropePmcTypes(types) {
  const t = types.map(x => String(x).toLowerCase());
  const has = s => t.some(x => x.includes(s));
  if (has("meta-analysis") || has("systematic review")) return "META";
  if (has("randomized controlled trial")) return "RCT";
  if (has("guideline")) return "GUIDE";
  if (has("observational study")) return "OBS";
  if (has("case reports") || has("case report")) return "CASE";
  if (has("review")) return "REVIEW";
  return null;
}

/* Europe PMCの検索クエリ言語で1件分の識別子条件を組み立てる。PMIDがあればPMID指定（PubMed収録分に限定）、
   なければDOI指定にする（DOIのみの論文もカバーするため） */
function europePmcQueryTerm(p) {
  if (p.pmid) return "EXT_ID:" + p.pmid + " AND SRC:MED";
  if (p.doi) return "DOI:\"" + p.doi + "\"";
  return null;
}

async function fetchEuropePmcTypesBatch(papers) {
  const byPmid = new Map(), byDoi = new Map(), terms = [];
  for (const p of papers) {
    const term = europePmcQueryTerm(p);
    if (!term) continue;
    terms.push(term);
    if (p.pmid) byPmid.set(String(p.pmid), p);
    else if (p.doi) byDoi.set(String(p.doi).toLowerCase(), p);
  }
  if (!terms.length) return;

  const CHUNK = 15; // クエリ文字列が長くなりすぎないよう小分けにする
  for (let i = 0; i < terms.length; i += CHUNK) {
    const chunk = terms.slice(i, i + CHUNK);
    const url = new URL(EUROPEPMC_BASE);
    url.searchParams.set("query", chunk.join(" OR "));
    url.searchParams.set("format", "json");
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", "100");
    let data;
    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      data = await res.json();
    } catch (e) { continue; /* 補助情報なので、この分だけ諦めて続行する */ }

    const results = (data.resultList && data.resultList.result) || [];
    for (const rec of results) {
      const listField = rec.pubTypeList && rec.pubTypeList.pubType;
      if (!listField) continue;
      const arr = Array.isArray(listField) ? listField : [listField];
      const cat = classifyFromEuropePmcTypes(arr);
      if (!cat) continue;
      let p = null;
      if (rec.pmid && byPmid.has(String(rec.pmid))) p = byPmid.get(String(rec.pmid));
      else if (rec.doi && byDoi.has(String(rec.doi).toLowerCase())) p = byDoi.get(String(rec.doi).toLowerCase());
      if (p) { p.study = cat; p.studySource = "europepmc"; }
    }
  }
}

async function enrichStudyTypesWithEuropePmc(papers) {
  // 対象は「PubMedで確定しなかった(依然としてOTHERのまま)論文」または「PMIDがなくPubMedの判定自体を
  // 受けられなかった論文」のみ。既にPubMedで確定した論文は対象にせず、追加のAPI呼び出しを最小限にする
  const targets = papers.filter(p => p && (p.study === "OTHER" || !p.pmid) && (p.pmid || p.doi));
  if (!targets.length) return;
  try { await fetchEuropePmcTypesBatch(targets); } catch (e) { /* 補助情報なので失敗しても継続 */ }
}

/* ============ Europe PMCによる引用/被引用ネットワークの補完 ============
   OpenAlexの引用グラフ(referenced_works / cites:フィルタ)は、出版社が参考文献データを
   十分に提供していない場合などに欠落することがある。Europe PMCの引用文献/被引用文献APIで
   見つかった、OpenAlexの結果に含まれていない論文を追加取得し、まとめて返す。
   失敗しても補助情報として扱い、既存(OpenAlex側)の結果はそのまま活かして処理を続ける。 */

const EUROPEPMC_REST_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

/* 論文のEurope PMC上の識別子(source/id)を特定する。PMIDがあれば直接(MEDLINE=MED)、
   なければDOI検索で解決する(プレプリント等、Europe PMC独自のsource/idを持つ場合に対応) */
async function europePmcIdentity(paper) {
  if (paper.pmid) return { source: "MED", id: paper.pmid };
  if (!paper.doi) return null;
  const url = new URL(EUROPEPMC_BASE);
  url.searchParams.set("query", "DOI:\"" + paper.doi + "\"");
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "1");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const rec = (data.resultList && data.resultList.result && data.resultList.result[0]) || null;
    if (!rec) return null;
    return { source: rec.source || "MED", id: rec.pmid || rec.id };
  } catch (e) { return null; }
}

/* 指定した論文の引用文献(kind="references")または被引用文献(kind="citations")の識別子一覧をEurope PMCから取得する。
   resultType=coreを指定しないとdoi等の識別子フィールドが応答に含まれないため必須。
   各項目はdoi/pmidのどちらか一方、両方、またはどちらも無い場合がある */
async function fetchEuropePmcLinkedRefs(paper, kind) {
  const identity = await europePmcIdentity(paper);
  if (!identity) return [];
  const url = new URL(EUROPEPMC_REST_BASE + "/" + identity.source + "/" + identity.id + "/" + kind);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "1000");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const listKey = kind === "references" ? "referenceList" : "citationList";
    const itemKey = kind === "references" ? "reference" : "citation";
    const items = (data[listKey] && data[listKey][itemKey]) || [];
    // MEDLINE(source==="MED")由来の項目は、専用のpmidフィールドではなく、idフィールドの値自体がPMIDになる
    return items.map(it => ({
      doi: it.doi || null,
      pmid: it.pmid || ((it.source === "MED" && it.id) ? it.id : null)
    })).filter(x => x.doi || x.pmid);
  } catch (e) { return []; }
}

/* DOIのリストからOpenAlexの書誌情報をまとめて取得する(50件ずつのOR構文、fetchWorksByIdsのDOI版) */
async function fetchWorksByDois(dois) {
  const out = [];
  for (let i = 0; i < dois.length; i += 50) {
    const chunk = dois.slice(i, i + 50);
    try {
      const data = await apiGet("/works", {
        filter: "doi:" + chunk.join("|"),
        "per-page": String(chunk.length),
        select: SELECT_FIELDS
      });
      out.push(...(data.results || []));
    } catch (e) { /* 補助情報なので、この分だけ諦めて続行する */ }
  }
  return out;
}

/* PMIDからOpenAlexの書誌情報を1件取得する(起点論文の取得(fetchRootWork)と同じ個別取得の仕組みを再利用。
   バッチ用のfilter構文がPMIDに対しても確実に使えるか未確認のため、確実に動く個別取得を選んだ) */
async function fetchWorkByPmid(pmid) {
  try { return await apiGet("/works/pmid:" + pmid, { select: SELECT_FIELDS }); }
  catch (e) { return null; }
}

const EUROPEPMC_PMID_FALLBACK_MAX = 40; // DOIで解決できなかった項目をPMIDで個別取得する際の上限件数

/* 既存の候補一覧(OpenAlex由来、doi/pmidで重複判定)にない、Europe PMCで見つかった論文を追加取得する。
   まずDOIでまとめて解決し、DOIが無い/DOIでは見つからなかった項目はPMIDで個別に解決を試みる */
async function supplementWithEuropePmc(paper, kind, existingPapers, rel) {
  try {
    const links = await fetchEuropePmcLinkedRefs(paper, kind);
    if (!links.length) return [];
    const knownDois = new Set(existingPapers.map(p => p.doi && p.doi.toLowerCase()).filter(Boolean));
    const knownPmids = new Set(existingPapers.map(p => p.pmid).filter(Boolean));

    const missingDois = [...new Set(links.filter(l => l.doi && !knownDois.has(l.doi.toLowerCase())).map(l => l.doi))];
    const worksFromDoi = missingDois.length ? await fetchWorksByDois(missingDois) : [];
    const resolvedDois = new Set(worksFromDoi.map(w => stripDoi(w.doi)).filter(Boolean).map(d => d.toLowerCase()));

    const missingPmids = [...new Set(
      links
        .filter(l => l.pmid && !knownPmids.has(l.pmid) && (!l.doi || !resolvedDois.has(l.doi.toLowerCase())))
        .map(l => l.pmid)
    )].slice(0, EUROPEPMC_PMID_FALLBACK_MAX);
    const worksFromPmid = missingPmids.length
      ? (await Promise.all(missingPmids.map(fetchWorkByPmid))).filter(Boolean)
      : [];

    return worksFromDoi.concat(worksFromPmid).map(w => { const p = toPaper(w, rel); p.citationSource = "europepmc"; return p; });
  } catch (e) { return []; }
}

/* 過去文献(参考文献)：OpenAlexのreferencedWorksに、Europe PMCで見つかった不足分を足して返す。
   OpenAlexにreferencedWorksが1件もない論文でも、Europe PMC側だけで見つかる場合がある */
async function fetchPastPapersSupplemented(paper, limit) {
  const referencedIds = paper.referencedWorks || [];
  const fromOpenAlex = referencedIds.length
    ? (await fetchWorksByIds(referencedIds)).map(w => toPaper(w, "past"))
    : [];
  const supplement = await supplementWithEuropePmc(paper, "references", fromOpenAlex, "past");
  const merged = fromOpenAlex.concat(supplement).sort((a, b) => (b.cites || 0) - (a.cites || 0));
  return { papers: merged.slice(0, limit), total: merged.length };
}

/* 未来文献(被引用文献)：OpenAlexのcites:フィルタに、Europe PMCで見つかった不足分を足して返す */
async function fetchFuturePapersSupplemented(paper, limit) {
  let fromOpenAlex = [];
  try {
    const data = await apiGet("/works", {
      filter: "cites:" + paper.id,
      sort: "cited_by_count:desc",
      "per-page": "200",
      select: SELECT_FIELDS
    });
    fromOpenAlex = (data.results || []).map(w => toPaper(w, "future"));
  } catch (e) { /* OpenAlex側が失敗しても、Europe PMC側だけでの続行を試みる */ }
  const supplement = await supplementWithEuropePmc(paper, "citations", fromOpenAlex, "future");
  const merged = fromOpenAlex.concat(supplement).sort((a, b) => (b.cites || 0) - (a.cites || 0));
  return { papers: merged.slice(0, limit), total: merged.length };
}

/* ============ エラーメッセージ ============ */
function apiErrorMessage(e) {
  switch (e && e.code) {
    case "notfound":
      return "該当する論文を取得できませんでした。DOIまたはPMIDが正しいか確認して、もう一度お試しください。DOIやPMIDが正しくても、OpenAlexに未登録の場合があります。";
    case "auth":
      return "APIキーが設定されていないか、無効です。右上の「APIキー設定」から、OpenAlexの無料APIキーを登録してください。";
    case "limit":
      return "データ提供サービス（OpenAlex）の利用上限に達した可能性があります。無料枠は毎日リセットされます。時間を置いて再度お試しください。";
    case "network":
      return "通信エラーが発生しました。インターネット接続を確認して、もう一度お試しください。";
    case "badresponse":
      return "データの形式に問題があり、読み込めませんでした。時間を置いて再度お試しください。";
    default:
      return "論文情報を取得できませんでした。時間を置いて再度お試しください。（コード: " + (e && e.status || "不明") + "）";
  }
}

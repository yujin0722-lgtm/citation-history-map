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

/* 過去文献：referencedWorks のIDリストから取得し、被引用数の多い順に上位limit件 */
async function fetchPastPapers(referencedIds, limit) {
  const total = referencedIds.length;
  if (!total) return { papers: [], total: 0 };
  const works = await fetchWorksByIds(referencedIds);
  const papers = works.map(w => toPaper(w, "past"))
    .sort((a, b) => (b.cites || 0) - (a.cites || 0))
    .slice(0, limit);
  return { papers: papers, total: total };
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

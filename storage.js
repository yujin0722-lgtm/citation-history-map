/* storage.js — お気に入りとAPIキーのブラウザ内保存 */

const CHM_FAV_KEY = "chm_favorites";
const CHM_API_KEY = "chm_openalex_key";

function storageAvailable() {
  try {
    localStorage.setItem("__chm_test", "1");
    localStorage.removeItem("__chm_test");
    return true;
  } catch (e) { return false; }
}
const HAS_STORAGE = storageAvailable();

/* ---- APIキー ---- */
function getApiKey() {
  if (window.CHM_CONFIG && window.CHM_CONFIG.OPENALEX_API_KEY) {
    return window.CHM_CONFIG.OPENALEX_API_KEY;
  }
  if (HAS_STORAGE) return localStorage.getItem(CHM_API_KEY) || "";
  return "";
}
function saveApiKey(key) {
  if (HAS_STORAGE) localStorage.setItem(CHM_API_KEY, key.trim());
}

/* ---- お気に入り ---- */
function loadFavorites() {
  if (!HAS_STORAGE) return new Map();
  try {
    const arr = JSON.parse(localStorage.getItem(CHM_FAV_KEY) || "[]");
    return new Map(arr.map(p => [p.id, p]));
  } catch (e) { return new Map(); }
}
function persistFavorites(map) {
  if (!HAS_STORAGE) return;
  const arr = [...map.values()].map(p => ({
    id: p.id, title: p.title, authors: p.authors, year: p.year,
    journal: p.journal, doi: p.doi, pmid: p.pmid, savedAt: p.savedAt || new Date().toISOString()
  }));
  localStorage.setItem(CHM_FAV_KEY, JSON.stringify(arr));
}

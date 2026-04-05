/**
 * DirectorCountryPanel.jsx — Country intelligence panel for Director Mode.
 *
 * Shown on the right side when click_country is fired. Fetches and displays
 * recent news and events for the given country name.
 *
 * Props:
 *   country   {string|null}  — country name to display, or null to hide
 *   onClose   {function}     — called when panel is dismissed
 */

import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"

const PANEL_STYLES = `
@keyframes dir-country-panel-in {
  from { opacity: 0; transform: translateX(24px); }
  to   { opacity: 1; transform: translateX(0); }
}
.dir-country-panel {
  position: fixed;
  top: 54px;
  right: 0;
  width: 320px;
  bottom: 50px;
  z-index: 8200;
  background: rgba(6, 14, 32, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-left: 1px solid rgba(56, 139, 255, 0.18);
  box-shadow: -4px 0 32px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  animation: dir-country-panel-in 350ms ease-out forwards;
  font-family: Inter, -apple-system, sans-serif;
}
.dir-country-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(56,139,255,0.12);
  flex-shrink: 0;
}
.dir-country-panel-title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: #e2e8f0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.dir-country-panel-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(86,207,255,0.7);
  background: rgba(86,207,255,0.1);
  border: 1px solid rgba(86,207,255,0.2);
  border-radius: 3px;
  padding: 2px 6px;
}
.dir-country-panel-close {
  width: 28px;
  height: 28px;
  border: none;
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  color: rgba(200,220,255,0.6);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.dir-country-panel-close:hover { background: rgba(255,80,80,0.15); color: #ff8080; }

.dir-country-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}
.dir-country-panel-body::-webkit-scrollbar { width: 3px; }
.dir-country-panel-body::-webkit-scrollbar-thumb { background: rgba(56,139,255,0.3); border-radius: 2px; }

.dir-country-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: rgba(160,180,220,0.5);
  font-size: 13px;
}

@keyframes dir-country-spin {
  to { transform: rotate(360deg); }
}
.dir-country-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(56,139,255,0.2);
  border-top-color: #56cfff;
  border-radius: 50%;
  animation: dir-country-spin 0.7s linear infinite;
}

.dir-country-empty {
  padding: 30px 16px;
  font-size: 13px;
  color: rgba(160,180,220,0.4);
  text-align: center;
  line-height: 1.5;
}

.dir-country-section-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(86,207,255,0.5);
  padding: 4px 16px 6px;
}

.dir-country-article {
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  cursor: pointer;
  transition: background 0.12s;
}
.dir-country-article:hover { background: rgba(56,139,255,0.06); }
.dir-country-article:last-child { border-bottom: none; }

.dir-country-article-headline {
  font-size: 12px;
  font-weight: 500;
  color: rgba(210,230,255,0.9);
  line-height: 1.45;
  margin-bottom: 4px;
}
.dir-country-article-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dir-country-article-source {
  font-size: 10px;
  color: rgba(86,207,255,0.6);
  font-weight: 600;
}
.dir-country-article-time {
  font-size: 10px;
  color: rgba(130,150,190,0.5);
}
.dir-country-article-severity {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: auto;
}
.dir-country-article-severity.critical { background: rgba(239,68,68,0.2); color: #f87171; }
.dir-country-article-severity.significant { background: rgba(245,158,11,0.2); color: #fbbf24; }
.dir-country-article-severity.elevated { background: rgba(59,130,246,0.2); color: #93c5fd; }
.dir-country-article-severity.low { background: rgba(107,114,128,0.2); color: #9ca3af; }

@media (max-width: 768px) {
  .dir-country-panel {
    width: 100%;
    top: 0;
    bottom: 0;
    border-left: none;
    border-top: 1px solid rgba(56,139,255,0.18);
    z-index: 9100;
  }
}
`

function formatRelativeTime(ts) {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Country name normalization for headline matching
function normalizeForMatch(s) {
  return (s || "").toLowerCase().replace(/[^a-z ]/g, "").trim()
}

const COUNTRY_ALIASES = {
  "united states":         ["usa", "us", "america", "american", "united states of america"],
  "united kingdom":        ["uk", "britain", "british", "england", "great britain"],
  "russia":                ["russian", "russian federation"],
  "china":                 ["chinese", "prc", "peoples republic of china"],
  "iran":                  ["iranian", "tehran", "islamic republic of iran"],
  "israel":                ["israeli", "tel aviv", "jerusalem"],
  "saudi arabia":          ["saudi", "riyadh", "ksa"],
  "united arab emirates":  ["uae", "emirati", "dubai", "abu dhabi"],
  "yemen":                 ["yemeni", "houthi", "sana", "aden"],
  "ukraine":               ["ukrainian", "kyiv", "kiev"],
  "turkey":                ["turkish", "ankara", "turkiye"],
  "north korea":           ["dprk", "kim jong", "pyongyang"],
  "south korea":           ["korean", "seoul"],
  "pakistan":              ["pakistani", "islamabad"],
  "india":                 ["indian", "new delhi", "delhi"],
  "syria":                 ["syrian", "damascus", "assad"],
  "iraq":                  ["iraqi", "baghdad"],
  "afghanistan":           ["afghan", "kabul", "taliban"],
  "ethiopia":              ["ethiopian", "addis ababa"],
  "somalia":               ["somali", "mogadishu", "al-shabaab"],
  "sudan":                 ["sudanese", "khartoum"],
}

function articleMatchesCountry(article, country) {
  const cn = normalizeForMatch(country)
  const text = normalizeForMatch(
    [article.headline, article.title, article.location, article.region, article.country, article.summary].join(" ")
  )

  // Direct match
  if (text.includes(cn)) return true

  // Alias match
  const aliases = COUNTRY_ALIASES[cn] || []
  for (const alias of aliases) {
    if (text.includes(normalizeForMatch(alias))) return true
  }

  return false
}

export default function DirectorCountryPanel({ country = null, onClose = () => {} }) {
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!country) { setArticles([]); return }

    setLoading(true)
    setArticles([])

    // Cancel any previous fetch
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    const tok = localStorage.getItem("hw-auth-token")
    const headers = tok ? { Authorization: `Bearer ${tok}` } : {}

    fetch(`${API_BASE}/api/surface`, { headers, signal: abortRef.current.signal })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(data => {
        const items = Array.isArray(data) ? data : (data.items || [])
        // Filter items relevant to this country
        const filtered = items.filter(a => articleMatchesCountry(a, country))
        // Sort by published desc
        filtered.sort((a, b) => {
          const ta = new Date(a.published_at || a.published || 0).getTime()
          const tb = new Date(b.published_at || b.published || 0).getTime()
          return tb - ta
        })
        setArticles(filtered.slice(0, 30))
        setLoading(false)
      })
      .catch(err => {
        if (err.name !== "AbortError") {
          console.warn("[DirectorCountryPanel] fetch error:", err)
          setLoading(false)
        }
      })

    return () => { abortRef.current?.abort() }
  }, [country])

  if (!country) return null

  return (
    <>
      <style>{PANEL_STYLES}</style>
      <div className="dir-country-panel">
        <div className="dir-country-panel-header">
          <div className="dir-country-panel-title">{country}</div>
          <div className="dir-country-panel-badge">Intelligence Feed</div>
          <button className="dir-country-panel-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="dir-country-panel-body">
          {loading && (
            <div className="dir-country-loading">
              <div className="dir-country-spinner" />
              Loading intelligence…
            </div>
          )}

          {!loading && articles.length === 0 && (
            <div className="dir-country-empty">
              No recent intelligence found for <strong style={{ color: "#e2e8f0" }}>{country}</strong>.
            </div>
          )}

          {!loading && articles.length > 0 && (
            <>
              <div className="dir-country-section-label">
                {articles.length} recent item{articles.length !== 1 ? "s" : ""}
              </div>
              {articles.map((a, i) => {
                const headline  = a.headline || a.title || a.clean_title || "Untitled"
                const source    = a.source || a.source_name || ""
                const ts        = a.published_at || a.published || ""
                const severity  = a.severity_tier || ""
                return (
                  <div key={a.id || i} className="dir-country-article">
                    <div className="dir-country-article-headline">{headline}</div>
                    <div className="dir-country-article-meta">
                      {source && <span className="dir-country-article-source">{source}</span>}
                      {ts     && <span className="dir-country-article-time">{formatRelativeTime(ts)}</span>}
                      {severity && (
                        <span className={`dir-country-article-severity ${severity}`}>{severity}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </>
  )
}

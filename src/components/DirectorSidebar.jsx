/**
 * DirectorSidebar.jsx — Left narration sidebar for Director Mode (desktop only).
 * Slides in from the left, shows current narration, image, indicators,
 * context cards, and scrollable previous segment history.
 * Mobile: hidden (DirectorSubtitle subtitles used instead).
 */

import { useState, useEffect, useRef, useCallback } from "react"

const SIDEBAR_STYLES = `
  @keyframes dir-sidebar-in {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0); }
  }
  @keyframes dir-narration-fade {
    from { opacity: 0; transform: translateY(5px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes dir-img-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes dir-skeleton-shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position: 400px 0; }
  }
  @keyframes dir-spin {
    to { transform: rotate(360deg); }
  }

  .dir-sidebar {
    position: fixed;
    left: 48px;
    top: 54px;
    bottom: 50px;
    width: 340px;
    background: rgba(4, 10, 28, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    z-index: 8500;
    display: flex;
    flex-direction: column;
    animation: dir-sidebar-in 500ms ease-out forwards;
    overflow: hidden;
    font-family: Inter, -apple-system, sans-serif;
  }

  .dir-sidebar-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 18px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }
  .dir-sidebar-scroll::-webkit-scrollbar { width: 3px; }
  .dir-sidebar-scroll::-webkit-scrollbar-thumb {
    background: rgba(56,139,255,0.25);
    border-radius: 2px;
  }

  /* Heading */
  .dir-seg-heading {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #c89040;
    margin-bottom: 2px;
    flex-shrink: 0;
  }

  /* Narration text */
  .dir-narration-text {
    font-size: 14px;
    line-height: 1.65;
    color: rgba(225, 238, 255, 0.9);
    animation: dir-narration-fade 350ms ease-out;
    flex-shrink: 0;
  }

  /* Image area */
  .dir-img-area {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
    background: rgba(0,0,0,0.25);
  }
  .dir-img-area img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
    animation: dir-img-fade 400ms ease-out;
  }
  .dir-img-caption {
    font-size: 11px;
    color: rgba(180, 205, 245, 0.65);
    padding: 6px 10px 4px;
    line-height: 1.35;
  }
  .dir-img-attribution {
    font-size: 9px;
    color: rgba(120, 148, 195, 0.4);
    padding: 0 10px 7px;
  }
  .dir-img-skeleton {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: linear-gradient(
      90deg,
      rgba(255,255,255,0.03) 0%,
      rgba(255,255,255,0.09) 50%,
      rgba(255,255,255,0.03) 100%
    );
    background-size: 800px 100%;
    animation: dir-skeleton-shimmer 1.5s ease-in-out infinite;
  }

  /* Indicators */
  .dir-indicators {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
  }
  .dir-indicator-card {
    background: rgba(56,139,255,0.08);
    border: 1px solid rgba(56,139,255,0.15);
    border-radius: 6px;
    padding: 6px 9px;
    flex: 1;
    min-width: 90px;
  }
  .dir-indicator-label {
    font-size: 9px;
    color: rgba(140,170,220,0.55);
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }
  .dir-indicator-value {
    font-size: 13px;
    font-weight: 600;
    color: #b0d8ff;
    margin-top: 1px;
  }
  .dir-indicator-card.alert .dir-indicator-value { color: #ff8080; }
  .dir-indicator-card.trend .dir-indicator-value { color: #56cfff; }

  /* Context cards */
  .dir-context-cards {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
  }
  .dir-context-card {
    background: rgba(56,139,255,0.05);
    border: 1px solid rgba(56,139,255,0.14);
    border-left: 3px solid rgba(86,207,255,0.4);
    border-radius: 5px;
    padding: 6px 10px;
  }
  .dir-context-card-title {
    font-size: 10px;
    font-weight: 700;
    color: #56cfff;
    letter-spacing: 0.04em;
  }
  .dir-context-card-text {
    font-size: 11px;
    color: rgba(180,210,255,0.72);
    line-height: 1.4;
    margin-top: 2px;
  }
  .dir-context-card-source {
    font-size: 9px;
    color: rgba(120,155,200,0.4);
    margin-top: 2px;
  }

  /* Divider */
  .dir-divider {
    height: 1px;
    background: rgba(255,255,255,0.06);
    flex-shrink: 0;
  }

  /* History */
  .dir-history-label {
    font-size: 11px;
    color: rgba(140,170,215,0.7);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 600;
    flex-shrink: 0;
  }
  .dir-history-item {
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 5px;
    background: rgba(255,255,255,0.02);
    padding: 7px 10px;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .dir-history-item:hover { opacity: 0.75; background: rgba(255,255,255,0.03); }
  .dir-history-item-heading {
    font-size: 14px;
    font-weight: 700;
    color: #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 2px;
  }
  .dir-history-item-text {
    font-size: 13px;
    color: #e2e8f0;
    line-height: 1.4;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .dir-history-item.expanded .dir-history-item-text {
    -webkit-line-clamp: unset;
    display: block;
  }

  /* Segment counter */
  .dir-seg-counter {
    font-size: 10px;
    color: rgba(110, 140, 190, 0.4);
    text-align: center;
    flex-shrink: 0;
    padding: 5px 0 8px;
    border-top: 1px solid rgba(255,255,255,0.05);
  }

  /* Generate form */
  .dir-generate-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }
  .dir-generate-label {
    font-size: 10px;
    color: rgba(86,207,255,0.65);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }
  .dir-generate-input {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(56,139,255,0.22);
    border-radius: 7px;
    padding: 9px 11px;
    font-size: 13px;
    color: #d0e4ff;
    outline: none;
    resize: none;
    min-height: 70px;
    font-family: inherit;
    box-sizing: border-box;
    transition: border-color 0.15s;
    line-height: 1.5;
  }
  .dir-generate-input::placeholder { color: rgba(145,170,215,0.28); }
  .dir-generate-input:focus { border-color: rgba(56,139,255,0.5); }
  .dir-generate-btn {
    padding: 9px 14px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    border: none;
    border-radius: 7px;
    background: rgba(56,139,255,0.28);
    color: #88c0ff;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-transform: uppercase;
    font-family: inherit;
  }
  .dir-generate-btn:hover:not([disabled]) { background: rgba(56,139,255,0.48); color: #fff; }
  .dir-generate-btn[disabled] { opacity: 0.32; cursor: not-allowed; }

  .dir-spinner {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 2px solid rgba(56,139,255,0.25);
    border-top-color: #56cfff;
    border-radius: 50%;
    animation: dir-spin 0.7s linear infinite;
    vertical-align: middle;
    margin-right: 7px;
  }
  .dir-generating-msg {
    font-size: 13px;
    color: rgba(86,207,255,0.6);
    display: flex;
    align-items: center;
  }

  @media (max-width: 768px) {
    .dir-sidebar { display: none; }
  }
`

export default function DirectorSidebar({
  visible       = false,
  currentAction = null,
  segments      = [],       // [{action, segIdx}] — all narrate actions in order
  indicators    = [],
  contextCards  = [],
  currentImage  = null,     // {url, caption, attribution, loading} | null
  generating    = false,
  runnerState   = { currentIndex: -1, total: 0 },
  onGenerate    = () => {},
}) {
  const [intent,       setIntent]       = useState("")
  const [expandedHist, setExpandedHist] = useState(null)
  const [imgLoaded,    setImgLoaded]    = useState(false)
  const prevImgUrl                      = useRef(null)
  const inputRef                        = useRef(null)

  const { currentIndex, total } = runnerState
  const hasSequence = total > 0

  // Reset loaded flag when image URL changes
  useEffect(() => {
    const url = currentImage?.url || null
    if (url !== prevImgUrl.current) {
      setImgLoaded(false)
      prevImgUrl.current = url
    }
  }, [currentImage?.url])

  // Focus input when sidebar becomes visible and there's no sequence
  useEffect(() => {
    if (visible && !hasSequence && !generating) {
      setTimeout(() => inputRef.current?.focus(), 550)
    }
  }, [visible, hasSequence, generating])

  const handleGenerate = useCallback(() => {
    const val = intent.trim()
    if (!val || generating) return
    onGenerate(val)
    setIntent("")
  }, [intent, generating, onGenerate])

  const isSummary = currentAction?.action === "summary"

  // History = all segments except the most recent, shown newest-first
  // Filter out segments with no displayable content, deduplicate by heading
  const _seenHeadings = new Set()
  const previousSegments = segments.slice(0, -1).reverse().filter(seg => {
    const text = seg.action.action === "summary"
      ? (seg.action.sections?.[0]?.text || "")
      : (seg.action.text || "")
    if (!(seg.action.heading || seg.action.title || text)) return false
    const heading = seg.action.heading || seg.action.title || ""
    if (heading && _seenHeadings.has(heading)) return false
    if (heading) _seenHeadings.add(heading)
    return true
  })

  if (!visible) return null

  return (
    <>
      <style>{SIDEBAR_STYLES}</style>
      <div className="dir-sidebar">
        <div className="dir-sidebar-scroll">

          {/* ── Generating ── */}
          {generating && (
            <div className="dir-generating-msg">
              <span className="dir-spinner" />
              Generating intelligence briefing…
            </div>
          )}

          {/* ── Generate form (shown when no sequence and not generating) ── */}
          {!hasSequence && !generating && (
            <div className="dir-generate-form">
              <div className="dir-generate-label">New Briefing</div>
              <textarea
                ref={inputRef}
                className="dir-generate-input"
                placeholder={"Briefing intent…\ne.g. 'Red Sea shipping disruption' or 'Strait of Hormuz maritime security'"}
                value={intent}
                onChange={e => setIntent(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
              />
              <button
                className="dir-generate-btn"
                disabled={!intent.trim()}
                onClick={handleGenerate}
              >
                Generate Briefing
              </button>
            </div>
          )}

          {/* ── Current segment content ── */}
          {currentAction && !generating && (
            <>
              {/* Heading */}
              {(currentAction.heading || currentAction.title) && (
                <div className="dir-seg-heading">
                  {currentAction.heading || currentAction.title}
                </div>
              )}

              {/* Narration text (keyed by text so fade animates on change) */}
              {!isSummary && currentAction.text && (
                <div className="dir-narration-text" key={`narr-${currentIndex}`}>
                  {currentAction.text}
                </div>
              )}

              {/* Summary sections */}
              {isSummary && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(currentAction.sections || []).map((sec, i) => (
                    <div key={i}>
                      {sec.heading && (
                        <div className="dir-seg-heading" style={{ marginBottom: 3 }}>
                          {sec.heading}
                        </div>
                      )}
                      <div className="dir-narration-text" style={{ fontSize: 13 }} key={`sum-${i}`}>
                        {sec.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Image area */}
              {currentImage && (
                <div className="dir-img-area">
                  {currentImage.loading && !imgLoaded && (
                    <div className="dir-img-skeleton" />
                  )}
                  {currentImage.url && currentImage.isVideo ? (
                    <video
                      src={currentImage.url}
                      autoPlay loop muted playsInline
                      style={{ width: "100%", display: "block", maxHeight: 190, objectFit: "cover" }}
                      onCanPlay={() => setImgLoaded(true)}
                      onError={() => setImgLoaded(true)}
                    />
                  ) : currentImage.url ? (
                    <img
                      src={currentImage.url}
                      alt={currentImage.caption || ""}
                      style={{ display: imgLoaded ? "block" : "none" }}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setImgLoaded(true)}
                    />
                  ) : null}
                  {currentImage.caption && imgLoaded && (
                    <div className="dir-img-caption">{currentImage.caption}</div>
                  )}
                  {currentImage.attribution && imgLoaded && (
                    <div className="dir-img-attribution">{currentImage.attribution}</div>
                  )}
                </div>
              )}

              {/* Indicators */}
              {indicators.length > 0 && (
                <div className="dir-indicators">
                  {indicators.map((ind, i) => (
                    <div key={i} className={`dir-indicator-card ${ind.type || ""}`}>
                      <div className="dir-indicator-label">{ind.label}</div>
                      <div className="dir-indicator-value">{ind.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Context cards */}
              {contextCards.length > 0 && (
                <div className="dir-context-cards">
                  {contextCards.slice(-4).map((card, i) => (
                    <div key={i} className="dir-context-card">
                      <div className="dir-context-card-title">{card.title}</div>
                      <div className="dir-context-card-text">{card.summary}</div>
                      {card.source && (
                        <div className="dir-context-card-source">{card.source}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Previous segments history ── */}
          {previousSegments.length > 0 && (
            <>
              <div className="dir-divider" />
              <div className="dir-history-label">Previous segments</div>
              {previousSegments.map((seg, i) => {
                const isExpanded = expandedHist === i
                const heading = seg.action.heading || seg.action.title || "Intelligence Update"
                const text =
                  seg.action.action === "summary"
                    ? (seg.action.sections?.[0]?.text || "")
                    : (seg.action.text || "")
                return (
                  <div
                    key={i}
                    className={`dir-history-item${isExpanded ? " expanded" : ""}`}
                    onClick={() => setExpandedHist(isExpanded ? null : i)}
                  >
                    <div className="dir-history-item-heading">{heading}</div>
                    <div className="dir-history-item-text">{text}</div>
                  </div>
                )
              })}
            </>
          )}

        </div>

        {/* Segment counter */}
        {hasSequence && (
          <div className="dir-seg-counter">
            Segment {Math.max(0, currentIndex + 1)} of {total}
          </div>
        )}
      </div>
    </>
  )
}

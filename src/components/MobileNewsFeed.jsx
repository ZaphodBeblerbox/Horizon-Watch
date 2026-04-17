/**
 * MobileNewsFeed.jsx — TikTok-style full-screen vertical news feed for mobile.
 * One article per screen, swipe up/down to navigate.
 */
import { useState, useEffect, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"

const FEED_STYLES = `
  .mobile-feed-container {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: #000;
    overflow: hidden;
    z-index: 100;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  .mobile-feed-progress {
    position: absolute;
    top: max(16px, env(safe-area-inset-top));
    left: 52px;
    right: 16px;
    z-index: 10;
  }

  .mobile-feed-progress-track {
    display: flex;
    gap: 3px;
    height: 3px;
  }

  .mobile-feed-progress-segment {
    flex: 1;
    background: rgba(255,255,255,0.22);
    border-radius: 2px;
    transition: background 300ms;
    min-width: 0;
  }

  .mobile-feed-progress-segment.watched {
    background: rgba(255,255,255,0.55);
  }

  .mobile-feed-progress-segment.active {
    background: #00aaff;
    box-shadow: 0 0 6px rgba(0,170,255,0.5);
  }

  .mobile-feed-article {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    animation: mobile-feed-slide-in 350ms cubic-bezier(0.22,0.61,0.36,1);
  }

  @keyframes mobile-feed-slide-in {
    from { transform: translateY(28px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  .mobile-feed-background {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
  }

  .mobile-feed-background img {
    width: 100%; height: 100%;
    object-fit: cover;
    animation: mobile-feed-ken-burns 20s ease-in-out infinite alternate;
  }

  @keyframes mobile-feed-ken-burns {
    from { transform: scale(1)    translate(0,   0);  }
    to   { transform: scale(1.12) translate(-2%, 2%); }
  }

  .mobile-feed-gradient-bg {
    width: 100%; height: 100%;
    background: linear-gradient(135deg, #0a1628 0%, #1a2f4e 50%, #0f1e35 100%);
  }

  .mobile-feed-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(
      to bottom,
      rgba(0,0,0,0.45) 0%,
      rgba(0,0,0,0.08) 30%,
      rgba(0,0,0,0.25) 60%,
      rgba(0,0,0,0.88) 100%
    );
  }

  .mobile-feed-content {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding:
      calc(max(32px, env(safe-area-inset-top)) + 28px)
      20px
      calc(max(20px, env(safe-area-inset-bottom)) + 64px)
      20px;
    z-index: 2;
  }

  .mobile-feed-top { display: flex; justify-content: flex-start; }

  .mobile-feed-badges { display: flex; gap: 6px; flex-wrap: wrap; }

  .mobile-feed-badge {
    padding: 4px 9px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .mobile-feed-badge.sev-critical   { background: rgba(255,40,40,0.28);  color: #ff9090; border: 1px solid rgba(255,40,40,0.45); }
  .mobile-feed-badge.sev-significant{ background: rgba(255,140,0,0.25);  color: #ffc070; border: 1px solid rgba(255,140,0,0.4); }
  .mobile-feed-badge.sev-elevated   { background: rgba(234,179,8,0.22);  color: #fde68a; border: 1px solid rgba(234,179,8,0.4); }
  .mobile-feed-badge.sev-low        { background: rgba(16,185,129,0.2);  color: #6ee7b7; border: 1px solid rgba(16,185,129,0.35);}
  .mobile-feed-badge.tier-local     { background: rgba(0,170,255,0.22);  color: #7ad8ff; border: 1px solid rgba(0,170,255,0.38);}
  .mobile-feed-badge.tier-regional  { background: rgba(255,180,0,0.22);  color: #ffd270; border: 1px solid rgba(255,180,0,0.38);}
  .mobile-feed-badge.tier-intl      { background: rgba(100,255,100,0.18);color: #86efac; border: 1px solid rgba(100,255,100,0.35);}

  .mobile-feed-bottom {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mobile-feed-source {
    font-size: 12px;
    color: rgba(255,255,255,0.58);
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  .mobile-feed-time { margin-left: 4px; color: rgba(255,255,255,0.36); }

  .mobile-feed-title {
    font-size: 24px;
    font-weight: 800;
    color: #fff;
    line-height: 1.2;
    text-shadow: 0 2px 10px rgba(0,0,0,0.9);
    margin: 0;
    letter-spacing: -0.4px;
  }

  .mobile-feed-summary {
    font-size: 14px;
    color: rgba(255,255,255,0.82);
    line-height: 1.5;
    text-shadow: 0 1px 5px rgba(0,0,0,0.75);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .mobile-feed-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 2px;
  }

  .mobile-feed-action-button {
    flex: 1;
    padding: 13px 18px;
    border-radius: 100px;
    background: rgba(0,170,255,0.88);
    color: #fff;
    text-decoration: none;
    font-weight: 700;
    font-size: 14px;
    text-align: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: transform 120ms, background 120ms;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
  }

  .mobile-feed-action-button:active {
    transform: scale(0.96);
    background: rgba(0,145,220,1);
  }

  .mobile-feed-action-icons { display: flex; gap: 8px; }

  .mobile-feed-icon-button {
    width: 44px; height: 44px;
    border-radius: 50%;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.14);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    cursor: pointer;
    transition: background 120ms, transform 120ms;
  }

  .mobile-feed-icon-button:active {
    transform: scale(0.91);
    background: rgba(255,255,255,0.2);
  }

  .mobile-feed-swipe-hint {
    position: absolute;
    bottom: calc(max(72px, env(safe-area-inset-bottom)) + 80px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    color: rgba(255,255,255,0.55);
    font-size: 11px;
    animation: swipe-hint-bounce 2s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes swipe-hint-bounce {
    0%,100% { transform: translate(-50%,0);    opacity: 0.55; }
    50%      { transform: translate(-50%,-10px); opacity: 1; }
  }

  .mobile-feed-counter {
    position: absolute;
    top: calc(max(16px, env(safe-area-inset-top)) + 18px);
    right: 14px;
    color: rgba(255,255,255,0.55);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
    padding: 3px 9px;
    border-radius: 10px;
    z-index: 11;
  }

  .mobile-feed-loading {
    position: fixed;
    inset: 0;
    background: #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.6);
    gap: 16px;
    font-size: 13px;
    font-family: system-ui,-apple-system,sans-serif;
  }

  .mobile-feed-spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: #00aaff;
    border-radius: 50%;
    animation: mf-spin 0.9s linear infinite;
  }

  @keyframes mf-spin { to { transform: rotate(360deg); } }

  .mobile-feed-empty {
    position: fixed;
    inset: 0;
    background: #000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.45);
    gap: 18px;
    font-size: 13px;
    font-family: system-ui,-apple-system,sans-serif;
  }

  .mobile-feed-empty button {
    padding: 9px 20px;
    background: rgba(0,170,255,0.18);
    border: 1px solid rgba(0,170,255,0.38);
    color: #fff;
    border-radius: 20px;
    cursor: pointer;
    font-size: 13px;
  }
`

function _formatTimeAgo(timestamp) {
    try {
        const diffMin = Math.floor((Date.now() - new Date(timestamp)) / 60000)
        if (diffMin < 1)    return "just now"
        if (diffMin < 60)   return `${diffMin}m ago`
        if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`
        return `${Math.floor(diffMin / 1440)}d ago`
    } catch { return "" }
}

export default function MobileNewsFeed({ articles = [], loading = false, onRefresh }) {
    const [currentIndex, setCurrentIndex] = useState(0)
    const touchStartY    = useRef(0)
    const touchStartTime = useRef(0)
    const [imgLoaded, setImgLoaded] = useState(false)

    // Reset to top when articles change
    useEffect(() => {
        setCurrentIndex(0)
    }, [articles])

    // Reset imgLoaded when article changes
    useEffect(() => {
        setImgLoaded(false)
    }, [currentIndex])

    // Preload next 2 articles' images
    useEffect(() => {
        for (let i = 1; i <= 2; i++) {
            const next = articles[currentIndex + i]
            if (next) {
                const src = next.image_url || next.og_image || null
                if (src) {
                    const img = new window.Image()
                    img.src = src
                }
            }
        }
    }, [currentIndex, articles])

    const handleTouchStart = useCallback((e) => {
        touchStartY.current    = e.touches[0].clientY
        touchStartTime.current = Date.now()
    }, [])

    const handleTouchEnd = useCallback((e) => {
        const dy   = touchStartY.current - e.changedTouches[0].clientY
        const dt   = Date.now() - touchStartTime.current
        const vel  = Math.abs(dy) / dt
        if (Math.abs(dy) > 45 || vel > 0.28) {
            if (dy > 0 && currentIndex < articles.length - 1) {
                setCurrentIndex(i => i + 1)
            } else if (dy < 0 && currentIndex > 0) {
                setCurrentIndex(i => i - 1)
            }
        }
    }, [currentIndex, articles.length])

    if (loading) {
        return (
            <>
                <style>{FEED_STYLES}</style>
                <div className="mobile-feed-loading">
                    <div className="mobile-feed-spinner" />
                    <div>Loading feed…</div>
                </div>
            </>
        )
    }

    if (articles.length === 0) {
        return (
            <>
                <style>{FEED_STYLES}</style>
                <div className="mobile-feed-empty">
                    <div>No articles available</div>
                    {onRefresh && <button onClick={onRefresh}>Reload</button>}
                </div>
            </>
        )
    }

    const art  = articles[currentIndex]
    const href = art.url || art.link
    const src  = art.source_name || art.source || ""
    const ts   = art.latest_event || art.published_at || art.timestamp || art.published
    const img  = art.image_url || art.og_image || null
    const tier = art.tier
    const sev  = art.severity_tier
    const summ = art.summary || art.auto_brief || art.description || ""
    const title = art.headline || art.clean_title || art.title || "Untitled"

    // Only show up to 30 progress segments or they become invisible
    const maxSegs    = Math.min(articles.length, 30)
    const segStep    = Math.ceil(articles.length / maxSegs)
    const activeSeg  = Math.floor(currentIndex / segStep)

    return (
        <>
            <style>{FEED_STYLES}</style>
            <div
                className="mobile-feed-container"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                {/* Progress bar */}
                <div className="mobile-feed-progress">
                    <div className="mobile-feed-progress-track">
                        {Array.from({ length: maxSegs }).map((_, i) => (
                            <div
                                key={i}
                                className={`mobile-feed-progress-segment${i === activeSeg ? " active" : i < activeSeg ? " watched" : ""}`}
                            />
                        ))}
                    </div>
                </div>

                {/* Article counter */}
                <div className="mobile-feed-counter">{currentIndex + 1} / {articles.length}</div>

                {/* Article card — keyed so it re-animates on change */}
                <div className="mobile-feed-article" key={currentIndex}>
                    {/* Background */}
                    <div className="mobile-feed-background">
                        {img ? (
                            <img
                                src={img}
                                alt=""
                                onLoad={() => setImgLoaded(true)}
                                onError={(e) => { e.target.style.display = "none" }}
                            />
                        ) : (
                            <div className="mobile-feed-gradient-bg" />
                        )}
                        <div className="mobile-feed-overlay" />
                    </div>

                    {/* Content overlay */}
                    <div className="mobile-feed-content">
                        {/* Top: badges */}
                        <div className="mobile-feed-top">
                            <div className="mobile-feed-badges">
                                {sev && (
                                    <span className={`mobile-feed-badge sev-${sev}`}>{sev}</span>
                                )}
                                {tier && (
                                    <span className={`mobile-feed-badge tier-${tier === "international" ? "intl" : tier}`}>{tier}</span>
                                )}
                            </div>
                        </div>

                        {/* Bottom: text + actions */}
                        <div className="mobile-feed-bottom">
                            <div className="mobile-feed-source">
                                {src}
                                {ts && <span className="mobile-feed-time">· {_formatTimeAgo(ts)}</span>}
                            </div>

                            <h2 className="mobile-feed-title">{title}</h2>

                            {summ && (
                                <p className="mobile-feed-summary">{summ}</p>
                            )}

                            <div className="mobile-feed-actions">
                                <a
                                    href={href || "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mobile-feed-action-button"
                                    onClick={e => { if (!href) e.preventDefault() }}
                                >
                                    Read Full Article
                                </a>
                                <div className="mobile-feed-action-icons">
                                    {currentIndex > 0 && (
                                        <button
                                            className="mobile-feed-icon-button"
                                            title="Previous"
                                            onClick={() => setCurrentIndex(i => i - 1)}
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                                <polyline points="18 15 12 9 6 15"/>
                                            </svg>
                                        </button>
                                    )}
                                    {currentIndex < articles.length - 1 && (
                                        <button
                                            className="mobile-feed-icon-button"
                                            title="Next"
                                            onClick={() => setCurrentIndex(i => i + 1)}
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                                <polyline points="6 9 12 15 18 9"/>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Swipe hint on first article */}
                {currentIndex === 0 && articles.length > 1 && (
                    <div className="mobile-feed-swipe-hint">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <polyline points="18 15 12 9 6 15"/>
                        </svg>
                        <span>Swipe up for next</span>
                    </div>
                )}
            </div>
        </>
    )
}

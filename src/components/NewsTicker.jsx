import { useState, useEffect, useRef } from "react"

const CATEGORY_COLORS = {
    conflict:       '#FF3B30',
    maritime:       '#34AADC',
    aviation:       '#5856D6',
    energy:         '#FFCC00',
    infrastructure: '#FF9500',
    cyber:          '#FF2D55',
    disaster:       '#FF6B35',
    political:      '#8E8E93',
}

function formatAge(ts) {
    if (!ts) return ''
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
    if (mins < 60)  return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
}

export default function NewsTicker({ visible }) {
    const [articles, setArticles] = useState([])
    const [offset,   setOffset]   = useState(0)
    const tickerRef               = useRef(null)
    const animRef                 = useRef(null)

    const API = import.meta.env.VITE_API_BASE || ''

    useEffect(() => {
        if (!visible) { setArticles([]); setOffset(0); return }

        const fetchArticles = () => {
            fetch(`${API}/api/v2/events?mode=events&limit=40`)
                .then(r => r.ok ? r.json() : {})
                .then(d => {
                    const items = Array.isArray(d) ? d : (d?.events || [])
                    setArticles(items.filter(a => a.event_title || a.headline))
                })
                .catch(() => {})
        }
        fetchArticles()
        const iv = setInterval(fetchArticles, 120_000)
        return () => clearInterval(iv)
    }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

    // Smooth scroll
    useEffect(() => {
        if (!visible || !articles.length) return
        setOffset(0) // reset position when article list changes to prevent snap

        const SPEED = 0.4 // px per frame

        const animate = () => {
            setOffset(prev => {
                const ticker = tickerRef.current
                if (!ticker) return prev
                const totalWidth = ticker.scrollWidth / 2
                return prev >= totalWidth ? 0 : prev + SPEED
            })
            animRef.current = requestAnimationFrame(animate)
        }
        animRef.current = requestAnimationFrame(animate)
        return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
    }, [visible, articles.length])

    if (!visible || !articles.length) return null

    const doubled = [...articles, ...articles]

    return (
        <div style={{
            position:       'fixed',
            bottom:         0,
            left:           0,
            right:          0,
            height:         32,
            background:     'rgba(5,10,20,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderTop:      '1px solid rgba(0,212,255,0.1)',
            zIndex:         200,
            overflow:       'hidden',
            display:        'flex',
            alignItems:     'center',
        }}>
            {/* LIVE badge */}
            <div style={{
                flexShrink:  0,
                padding:     '0 12px',
                borderRight: '1px solid rgba(0,212,255,0.15)',
                height:      '100%',
                display:     'flex',
                alignItems:  'center',
                gap:         5,
            }}>
                <div style={{
                    width:        5,
                    height:       5,
                    borderRadius: '50%',
                    background:   '#FF3B30',
                    boxShadow:    '0 0 6px #FF3B30',
                    animation:    'pulse-dot 1s ease infinite',
                }} />
                <span style={{
                    fontFamily:    '"IBM Plex Mono", "Courier New", monospace',
                    fontSize:      8,
                    fontWeight:    700,
                    color:         '#FF3B30',
                    letterSpacing: 2,
                }}>
                    LIVE
                </span>
            </div>

            {/* Scrolling content */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <div
                    ref={tickerRef}
                    style={{
                        display:   'flex',
                        alignItems:'center',
                        whiteSpace:'nowrap',
                        transform: `translateX(-${offset}px)`,
                    }}
                >
                    {doubled.map((article, i) => {
                        const cat   = (article.article_type || article.icon_type || 'other').toLowerCase()
                        const color = CATEGORY_COLORS[cat] || '#8E8E93'
                        const title = article.event_title || article.headline || ''
                        const age   = formatAge(article.published_at || article.created_at || article.published)

                        return (
                            <span key={i} style={{
                                display:     'inline-flex',
                                alignItems:  'center',
                                gap:         6,
                                padding:     '0 24px',
                                borderRight: '1px solid rgba(255,255,255,0.04)',
                                fontFamily:  '"IBM Plex Mono", "Courier New", monospace',
                                fontSize:    10,
                            }}>
                                <span style={{ color, opacity: 0.6 }}>◆</span>
                                <span style={{
                                    fontSize:      8,
                                    fontWeight:    700,
                                    color,
                                    letterSpacing: 1.5,
                                    opacity:       0.8,
                                }}>
                                    {cat.toUpperCase()}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.75)' }}>
                                    {title}
                                </span>
                                {article.source_name && (
                                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9 }}>
                                        {article.source_name}
                                    </span>
                                )}
                                {age && (
                                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>
                                        {age}
                                    </span>
                                )}
                            </span>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

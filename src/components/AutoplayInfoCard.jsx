const TYPE_BADGES = {
    zone: {
        escalating: { color: '#FF2D2D', label: 'ESCALATING' },
        emerging:   { color: '#FF9500', label: 'EMERGING'   },
        elevated:   { color: '#FFCC00', label: 'ELEVATED'   },
    },
    fusion:   { color: '#5856D6', label: 'FUSION EVENT'   },
    alert:    { color: '#34AADC', label: 'FORGE ALERT'    },
    surge:    { color: '#FF9500', label: 'NEWS SURGE'      },
    news:     { color: '#FF3B30', label: 'INTELLIGENCE'   },
    overview: { color: '#00D4FF', label: 'OVERVIEW'       },
}

function getBadge(seg) {
    if (seg.type === 'zone')
        return TYPE_BADGES.zone[seg.subtype] || TYPE_BADGES.zone.elevated
    return TYPE_BADGES[seg.type] || TYPE_BADGES.overview
}

export default function AutoplayInfoCard({ segment, index, total }) {
    if (!segment) return null

    const badge = getBadge(segment)
    const color = segment.color || badge?.color || '#34AADC'

    return (
        <div style={{
            position:      'fixed',
            bottom:        40,
            right:         16,
            width:         300,
            background:    'rgba(5,10,20,0.92)',
            backdropFilter:'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border:        `1px solid ${color}22`,
            borderLeft:    `3px solid ${color}`,
            borderRadius:  4,
            padding:       '12px 14px',
            fontFamily:    'var(--font-mono)',
            zIndex:        190,
        }}>
            {/* Badge + counter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{
                    fontSize:        8,
                    fontWeight:      700,
                    letterSpacing:   1.5,
                    color,
                    padding:         '2px 7px',
                    border:          `1px solid ${color}44`,
                    borderRadius:    2,
                    background:      `${color}15`,
                }}>
                    {badge?.label || 'SIGNAL'}
                </div>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
                    {index + 1} / {total}
                </span>
            </div>

            {/* Title */}
            <div style={{
                fontSize:     12,
                fontWeight:   700,
                color:        'rgba(255,255,255,0.9)',
                letterSpacing:0.3,
                lineHeight:   1.35,
                marginBottom: 4,
            }}>
                {segment.title}
            </div>

            {/* Subtitle */}
            <div style={{
                fontSize:     9,
                color,
                opacity:      0.75,
                letterSpacing:0.5,
                marginBottom: 8,
            }}>
                {segment.subtitle}
            </div>

            {/* Narrative */}
            {segment.narrative && (
                <div style={{
                    fontSize:            10,
                    color:               'rgba(255,255,255,0.55)',
                    lineHeight:          1.6,
                    overflow:            'hidden',
                    display:             '-webkit-box',
                    WebkitLineClamp:     4,
                    WebkitBoxOrient:     'vertical',
                }}>
                    {segment.narrative}
                </div>
            )}

            {/* Zone threat score bar */}
            {segment.zone && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        flex:         1,
                        height:       2,
                        background:   'rgba(255,255,255,0.06)',
                        borderRadius: 1,
                    }}>
                        <div style={{
                            width:        `${Math.min(100, segment.zone.score || 0)}%`,
                            height:       '100%',
                            background:   color,
                            opacity:      0.7,
                            borderRadius: 1,
                        }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color }}>
                        {Math.round(segment.zone.score || 0)}
                    </span>
                </div>
            )}
        </div>
    )
}

/**
 * ModuleShell.jsx — PARALLAX v6, ▣ Module.
 *
 * The spec's generic workstation frame: a 36px head carrying an icon, a
 * title, tabs, a meta string, actions and a close; then a 12-column grid
 * of blocks underneath.
 *
 * IT IS A SHELL BECAUSE THE SPEC MADE IT ONE. ▣ Module is not a screen —
 * it is the shape several screens share, parameterised by `blocks`. Writing
 * it once means the next module is a list of blocks rather than another
 * 600-line file that reimplements a table.
 *
 * Block kinds, as the spec lists them: kpi, table, list, text, bars.
 * (slide and spark exist in the spec for Briefings and are not needed by
 * any module using this shell yet; they are not stubbed here, because an
 * unused branch is a branch nobody has checked.)
 */
import { MODE_SURFACE } from "../plx6/modeWindow.js"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt4)",
}

const I = ({ href, size = 13, color = "var(--txt3)" }) => (
    <svg width={size} height={size} style={{ color, flex: "none" }} aria-hidden><use href={href} /></svg>
)

function Head({ title, meta }) {
    if (!title && !meta) return null
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 8, minHeight: 32,
            padding: "0 12px", borderBottom: "1px solid var(--gline)",
        }}>
            <b style={{ fontWeight: 600, fontSize: 12.5 }}>{title}</b>
            {meta && <span style={{
                marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                fontSize: 10, color: "var(--txt4)",
            }}>{meta}</span>}
        </div>
    )
}

function Block({ b }) {
    return (
        <div style={{
            gridColumn: `span ${b.span || 12}`, display: "flex", flexDirection: "column",
            overflow: "hidden", minWidth: 0, border: "1px solid var(--gline)",
            background: "var(--glass2)", borderRadius: 0,
        }}>
            <Head title={b.title} meta={b.meta} />

            {b.kind === "kpi" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
                    {b.kpis.map((k, i) => (
                        <div key={k.k} style={{
                            padding: "12px 14px",
                            borderRight: i < b.kpis.length - 1 ? "1px solid var(--gline)" : 0,
                        }}>
                            <div style={{ ...EYE, letterSpacing: ".08em" }}>{k.k}</div>
                            <div style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 20, fontWeight: 600,
                                color: k.c || "var(--txt)", marginTop: 4,
                            }}>{k.v}</div>
                            {k.d && <div style={{ fontSize: 11, color: "var(--txt3)", marginTop: 2, textWrap: "pretty" }}>{k.d}</div>}
                        </div>
                    ))}
                </div>
            )}

            {b.kind === "table" && (
                <div style={{ overflow: "auto" }}>
                    <div style={{ minWidth: b.minW || "auto" }}>
                        <div style={{
                            display: "grid", gridTemplateColumns: b.cols, gap: 12,
                            padding: "7px 12px", borderBottom: "1px solid var(--gline)",
                        }}>
                            {b.head.map((h) => <span key={h} style={EYE}>{h}</span>)}
                        </div>
                        {b.rows.map((r, i) => (
                            <button key={r.key || i} onClick={r.go} style={{
                                display: "grid", gridTemplateColumns: b.cols, gap: 12,
                                alignItems: "center", width: "100%", padding: "8px 12px",
                                border: 0, borderBottom: "1px solid var(--gline)",
                                background: r.on ? "var(--accdim)" : "transparent",
                                color: "var(--txt)", font: "inherit", textAlign: "left",
                                cursor: r.go ? "pointer" : "default",
                            }}>
                                {r.cells.map((c, j) => (
                                    <span key={j} style={{
                                        minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                                        whiteSpace: "nowrap", color: c.c || "var(--txt)",
                                        fontFamily: c.mono ? "var(--mz-font-mono)" : "inherit",
                                        fontSize: c.fs || 13,
                                    }}>{c.v}</span>
                                ))}
                            </button>
                        ))}
                        {!b.rows.length && (
                            <div style={{ padding: 14, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                                {b.empty || "Nothing here."}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {b.kind === "list" && (
                <div style={{ overflow: "auto" }}>
                    {b.items.map((it, i) => (
                        <button key={it.key || i} onClick={it.go} style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                            gap: "2px 10px", width: "100%", padding: "9px 12px", border: 0,
                            borderBottom: "1px solid var(--gline)",
                            background: it.on ? "var(--accdim)" : "transparent",
                            color: "var(--txt)", font: "inherit", textAlign: "left",
                            cursor: it.go ? "pointer" : "default",
                        }}>
                            <b style={{
                                fontWeight: it.bold === false ? 400 : 600, minWidth: 0,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{it.title}</b>
                            {it.right && <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                color: it.rc || "var(--txt4)", whiteSpace: "nowrap",
                            }}>{it.right}</span>}
                            {it.sub && <span style={{
                                gridColumn: "1 / 3", fontSize: 11.5, color: "var(--txt3)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{it.sub}</span>}
                        </button>
                    ))}
                    {!b.items.length && (
                        <div style={{ padding: 14, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                            {b.empty || "Nothing here."}
                        </div>
                    )}
                </div>
            )}

            {b.kind === "text" && (
                <div style={{ padding: b.pad || "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {b.paras.map((pr, i) => {
                        if (pr.isMeta) return <span key={i} style={EYE}>{pr.t}</span>
                        if (pr.isTitle) return <h2 key={i} style={{
                            margin: 0, fontWeight: 600, fontSize: 20, lineHeight: 1.15,
                            letterSpacing: "-.01em", textWrap: "pretty",
                        }}>{pr.t}</h2>
                        if (pr.isH) return <b key={i} style={{ fontWeight: 600, fontSize: 14 }}>{pr.t}</b>
                        return <p key={i} style={{
                            margin: 0, fontSize: 13, lineHeight: 1.6,
                            color: "var(--txt2)", textWrap: "pretty",
                        }}>{pr.t}</p>
                    })}
                    {!b.paras.length && (
                        <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>{b.empty || "Nothing selected."}</span>
                    )}
                </div>
            )}

            {b.kind === "bars" && (
                <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
                    {b.items.map((it) => (
                        <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{
                                flex: "0 0 40%", minWidth: 0, fontSize: 12.5,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{it.k}</span>
                            <i style={{ flex: 1, height: 4, background: "var(--gline)" }}>
                                <i style={{ display: "block", height: 4, width: `${it.pct}%`, background: it.c || "var(--acchi)" }} />
                            </i>
                            <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 11,
                                color: "var(--txt2)", whiteSpace: "nowrap",
                            }}>{it.v}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function ModuleShell({
    icon, title, label = title, tabs = [], tab, onTab = () => {},
    meta = "", actions = [], blocks = [], onClose = null, children = null,
}) {
    return (
        <section data-screen-label={label} style={MODE_SURFACE}>
            <div style={{
                display: "flex", alignItems: "stretch", gap: 6, height: 36, flex: "none",
                padding: "0 8px 0 12px", borderBottom: "1px solid var(--gline)",
            }}>
                {icon && <span style={{ alignSelf: "center" }}><I href={icon} /></span>}
                <h3 style={{
                    margin: "0 8px 0 2px", fontSize: 12, fontWeight: 600,
                    whiteSpace: "nowrap", alignSelf: "center",
                }}>{title}</h3>

                <nav style={{ display: "flex", overflow: "auto", minWidth: 0 }}>
                    {tabs.map(([k, v]) => (
                        <button key={v} onClick={() => onTab(v)} style={{
                            padding: "0 12px", border: 0,
                            borderBottom: `2px solid ${tab === v ? "var(--acchi)" : "transparent"}`,
                            background: "transparent",
                            color: tab === v ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", whiteSpace: "nowrap", cursor: "pointer",
                        }}>{k}</button>
                    ))}
                </nav>

                <span style={{
                    alignSelf: "center", marginLeft: "auto", overflow: "hidden",
                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                    color: "var(--txt4)", whiteSpace: "nowrap",
                }}>{meta}</span>

                {actions.map((a) => (
                    <button key={a.k} onClick={a.go} title={a.title || ""} style={{
                        alignSelf: "center", height: 24, flex: "none", padding: "0 10px",
                        border: "1px solid var(--gline2)",
                        background: a.primary ? "var(--acc)" : "transparent",
                        color: a.primary ? "var(--mz-cream)" : "var(--txt)",
                        font: "inherit", fontSize: 11.5, whiteSpace: "nowrap",
                        cursor: "pointer", borderRadius: 0,
                    }}>{a.k}</button>
                ))}

                {onClose && (
                    <button onClick={onClose} title="Close" aria-label="Close" style={{
                        alignSelf: "center", width: 24, height: 24, flex: "none",
                        border: 0, background: "transparent", color: "var(--txt3)",
                        font: "inherit", cursor: "pointer",
                    }}>✕</button>
                )}
            </div>

            <div style={{
                flex: 1, minHeight: 0, overflow: "auto", display: "grid",
                gridTemplateColumns: "repeat(12,minmax(0,1fr))", gap: 12,
                padding: 14, alignContent: "start",
            }}>
                {blocks.map((b, i) => <Block key={b.key || i} b={b} />)}
                {children}
            </div>
        </section>
    )
}

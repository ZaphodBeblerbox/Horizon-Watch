import { useState, useEffect, useCallback, useRef } from "react"
import API_BASE from "../apiBase.js"
import TabBar from "./TabBar.jsx"

const API = API_BASE

// ── Folder config ─────────────────────────────────────────────────────────────
const FOLDERS = [
    { id: "claude-briefings", label: "Claude Briefings", readOnly: true  },
    { id: "my-documents",     label: "My Documents",     readOnly: false },
    { id: "saved-analysis",   label: "Saved Analysis",   readOnly: false },
    { id: "archived",         label: "Archived",         readOnly: false },
]

// ── Briefing content parser (reused from original) ────────────────────────────
const SECTION_HEADERS = [
    "SITUATION OVERVIEW", "KEY DEVELOPMENTS",
    "INDICATORS TO WATCH", "INFRASTRUCTURE STATUS", "TREND LINE",
]
function parseSections(content) {
    if (!content) return {}
    const sections = {}
    for (let i = 0; i < SECTION_HEADERS.length; i++) {
        const h    = SECTION_HEADERS[i]
        const next = SECTION_HEADERS[i + 1]
        const re   = new RegExp(`${h}[^\\n]*\\n([\\s\\S]*?)(?=${next ? next + "[^\\n]*\\n" : "$"})`, "i")
        const m    = content.match(re)
        if (m) sections[h] = m[1].trim()
    }
    return sections
}
function parseKeyDevelopments(text) {
    if (!text) return []
    return text.split(/\n/).map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean).map(line => {
        const tm = line.match(/^\[([^\]]+)\]\s*(.+)/)
        if (!tm) return { tag: null, body: line, soWhat: null }
        const rest = tm[2]
        const swi  = rest.search(/\bso what[:—]/i)
        if (swi === -1) return { tag: tm[1], body: rest, soWhat: null }
        return { tag: tm[1], body: rest.slice(0, swi).replace(/\.\s*$/, "").trim(), soWhat: rest.slice(swi).replace(/^so what[:—\s]*/i, "").trim() }
    })
}
function parseBulletList(text) {
    if (!text) return []
    return text.split(/\n/).map(l => l.replace(/^[-•*\d.]\s*/, "").trim()).filter(Boolean)
}

// ── Briefing section renderer ─────────────────────────────────────────────────
function BriefingSections({ content }) {
    const sections = parseSections(content)
    const hasAny   = Object.keys(sections).length > 0

    if (!hasAny) {
        // Strip common markdown symbols for clean rendering
        const clean = content
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1")
            .replace(/^#+\s*/gm, "")
            .replace(/^[-•]\s*/gm, "• ")
        return (
            <div style={{ fontSize: 13, color: "var(--akili-text-primary)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                {clean}
            </div>
        )
    }

    const prose = (text) => (
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--akili-text-primary)", margin: 0 }}>{text}</p>
    )
    const bullets = (text) => {
        const items = parseBulletList(text)
        return (
            <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {items.map((it, i) => <li key={i} style={{ fontSize: 13, color: "var(--akili-text-primary)", lineHeight: 1.5 }}>{it}</li>)}
            </ul>
        )
    }
    const keyDevs = (text) => {
        const items = parseKeyDevelopments(text)
        if (!items.length) return prose(text)
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((it, i) => (
                    <div key={i} style={{ padding: "8px 11px", background: "rgba(255,255,255,0.03)", borderRadius: 5, borderLeft: "2px solid rgba(26,110,181,0.5)" }}>
                        {it.tag && <span style={{ display: "inline-block", fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--akili-accent)", background: "rgba(26,110,181,0.12)", borderRadius: 3, padding: "1px 6px", marginBottom: 4 }}>{it.tag}</span>}
                        <div style={{ fontSize: 13, color: "var(--akili-text-primary)", lineHeight: 1.45 }}>{it.body}</div>
                        {it.soWhat && <div style={{ fontSize: 11, color: "var(--akili-text-secondary)", marginTop: 3 }}><span style={{ color: "var(--akili-accent)", fontWeight: 600 }}>So what: </span>{it.soWhat}</div>}
                    </div>
                ))}
            </div>
        )
    }

    const SH = ({ label }) => (
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--akili-accent)", marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(26,110,181,0.25)" }}>
            {label}
        </div>
    )

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {sections["SITUATION OVERVIEW"]   && <div><SH label="Situation Overview"   />{prose(sections["SITUATION OVERVIEW"])}</div>}
            {sections["KEY DEVELOPMENTS"]     && <div><SH label="Key Developments"     />{keyDevs(sections["KEY DEVELOPMENTS"])}</div>}
            {sections["INDICATORS TO WATCH"]  && <div><SH label="Indicators to Watch"  />{bullets(sections["INDICATORS TO WATCH"])}</div>}
            {sections["INFRASTRUCTURE STATUS"]&& <div><SH label="Infrastructure Status"/>{bullets(sections["INFRASTRUCTURE STATUS"])}</div>}
            {sections["TREND LINE"]           && <div><SH label="Trend Line"           />{prose(sections["TREND LINE"])}</div>}
        </div>
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
    if (!iso) return "—"
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
function fmtCountdown(s) {
    if (s <= 0) return null
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Toolbar button ────────────────────────────────────────────────────────────
function TBtn({ label, title, onClick }) {
    const [hov, setHov] = useState(false)
    return (
        <button
            onMouseDown={e => { e.preventDefault(); onClick() }}
            onMouseEnter={() => setHov(true)}
            onMouseLeave={() => setHov(false)}
            title={title}
            style={{
                height: 24, padding: "0 8px", fontSize: 11, fontWeight: 600,
                background: hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
                color: "var(--akili-text-secondary)", cursor: "pointer", flexShrink: 0,
                transition: "background 0.1s",
            }}
        >
            {label}
        </button>
    )
}

// ── Icon helpers ──────────────────────────────────────────────────────────────
function ChevronIcon({ open }) {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            {open ? <polyline points="2,7 5,4 8,7"/> : <polyline points="2,4 5,7 8,4"/>}
        </svg>
    )
}

function useIsMobile() {
    const [v, setV] = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    useEffect(() => {
        const h = () => setV(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])
    return v
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BriefingPanel({ onClose, onMarkRead, onReplay = null }) {
    const isMobile = useIsMobile()
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true)

    // ── Document list state ───────────────────────────────────────────────────
    const [docs,            setDocs]            = useState([])
    const [folderCounts,    setFolderCounts]    = useState({})
    const [expandedFolders, setExpandedFolders] = useState(new Set(["claude-briefings", "my-documents"]))
    const [selectedFolder,  setSelectedFolder]  = useState(null)
    const [searchQuery,     setSearchQuery]     = useState("")

    // ── Active document state ─────────────────────────────────────────────────
    const [activeDocId,  setActiveDocId]  = useState(null)
    const [activeDoc,    setActiveDoc]    = useState(null)   // full doc with content
    const [editTitle,    setEditTitle]    = useState("")
    const [isDirty,      setIsDirty]      = useState(false)
    const [saving,       setSaving]       = useState(false)
    const [saveMsg,      setSaveMsg]      = useState("")     // "Saved" flash

    // ── Briefing-specific state ───────────────────────────────────────────────
    const [briefingMeta,    setBriefingMeta]    = useState(null)   // { can_regenerate, next_regen_secs }
    const [generating,      setGenerating]      = useState(false)
    const [generateError,   setGenerateError]   = useState(null)
    const [countdown,       setCountdown]       = useState(0)
    const [lastBriefing,    setLastBriefing]    = useState(() => {
        try {
            const s = localStorage.getItem("hw_last_briefing")
            if (!s) return null
            const p = JSON.parse(s)
            if (Date.now() - (p._saved_at || 0) < 7_200_000) return p
        } catch {}
        return null
    })

    // ── Sub-tab state — tracks open documents as sub-tabs ─────────────────────
    const [openDocIds,  setOpenDocIds]  = useState([])          // ordered list of open doc ids
    const [openDocMeta, setOpenDocMeta] = useState({})          // id → { title, folder }

    // ── Loading/error ─────────────────────────────────────────────────────────
    const [docsLoading,   setDocsLoading]   = useState(true)
    const [docLoading,    setDocLoading]    = useState(false)
    const editorRef = useRef(null)

    // ── Fetch document list ───────────────────────────────────────────────────
    const refreshDocs = useCallback(() => {
        const url = searchQuery
            ? `${API}/api/documents?q=${encodeURIComponent(searchQuery)}`
            : `${API}/api/documents`
        fetch(url)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                setDocs(d.documents || [])
                // compute counts per folder
                const counts = {}
                ;(d.documents || []).forEach(doc => { counts[doc.folder] = (counts[doc.folder] || 0) + 1 })
                setFolderCounts(counts)
                setDocsLoading(false)
            })
            .catch(() => setDocsLoading(false))
    }, [searchQuery])

    useEffect(() => { refreshDocs() }, [refreshDocs])

    // ── Fetch briefing metadata ───────────────────────────────────────────────
    const fetchBriefingMeta = useCallback(() => {
        fetch(`${API}/api/briefing/latest`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d) return
                setBriefingMeta(d)
                setCountdown(d.next_regen_secs || 0)
                if (d.briefing) onMarkRead?.()
            })
            .catch(() => {})
    }, [onMarkRead])

    useEffect(() => { fetchBriefingMeta() }, [fetchBriefingMeta])

    useEffect(() => {
        if (countdown <= 0) return
        const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
        return () => clearInterval(t)
    }, [countdown])

    // ── Load a document ───────────────────────────────────────────────────────
    const loadDoc = useCallback((docId, folder, title) => {
        // On mobile: switch to content view when a doc is selected
        setMobileSidebarOpen(false)
        // Track as open sub-tab
        setOpenDocIds(prev => prev.includes(docId) ? prev : [...prev, docId])
        setOpenDocMeta(prev => ({
            ...prev,
            [docId]: { title: title || prev[docId]?.title || "Untitled", folder },
        }))
        setDocLoading(true)
        setIsDirty(false)
        setActiveDocId(docId)
        fetch(`${API}/api/documents/${docId}?folder=${folder}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d?.document) return
                setActiveDoc(d.document)
                setEditTitle(d.document.title || "")
                // Keep sub-tab label in sync with actual doc title
                if (d.document.title) {
                    setOpenDocMeta(prev => ({
                        ...prev,
                        [docId]: { ...prev[docId], title: d.document.title },
                    }))
                }
                if (editorRef.current && !d.document.read_only) {
                    editorRef.current.innerHTML = d.document.content || ""
                }
                setDocLoading(false)
            })
            .catch(() => setDocLoading(false))
    }, [])

    // ── Auto-save every 30s when dirty ────────────────────────────────────────
    const saveDoc = useCallback(() => {
        if (!activeDoc || activeDoc.read_only || !isDirty) return
        setSaving(true)
        const content = editorRef.current?.innerHTML || ""
        fetch(`${API}/api/documents/${activeDoc.id}`, {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ title: editTitle, content }),
        })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
            if (d) {
                setIsDirty(false)
                setSaveMsg("Saved")
                refreshDocs()
                setTimeout(() => setSaveMsg(""), 2000)
            }
        })
        .catch(() => {})
        .finally(() => setSaving(false))
    }, [activeDoc, isDirty, editTitle, refreshDocs])

    useEffect(() => {
        const t = setInterval(saveDoc, 30000)
        return () => clearInterval(t)
    }, [saveDoc])

    // ── New document ──────────────────────────────────────────────────────────
    const handleNewDoc = useCallback(() => {
        fetch(`${API}/api/documents`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ folder: "my-documents", title: "Untitled Document", content: "" }),
        })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
            if (!d?.document) return
            refreshDocs()
            setExpandedFolders(prev => new Set([...prev, "my-documents"]))
            loadDoc(d.document.id, "my-documents")
        })
        .catch(() => {})
    }, [refreshDocs, loadDoc])

    // ── Archive (delete) document ─────────────────────────────────────────────
    const handleArchive = useCallback(() => {
        if (!activeDoc || activeDoc.read_only) return
        if (!confirm(`Archive "${activeDoc.title}"?`)) return
        fetch(`${API}/api/documents/${activeDoc.id}`, { method: "DELETE" })
            .then(() => { setActiveDoc(null); setActiveDocId(null); refreshDocs() })
            .catch(() => {})
    }, [activeDoc, refreshDocs])

    // ── Briefing regenerate — uses Director (Sonnet streaming) endpoint ──────────
    const handleGenerate = useCallback(async () => {
        setGenerating(true)
        setGenerateError(null)
        try {
            const res = await fetch(`${API}/api/director/generate`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    intent: "Generate a comprehensive global intelligence briefing covering the most " +
                        "significant maritime anomalies, aviation incidents, active fusion events, news surges, " +
                        "and emerging conflict indicators from the past 24 hours. Lead with the highest-severity " +
                        "signals and end with a threat trajectory summary.",
                }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err?.detail || err?.message || `HTTP ${res.status}`)
            }
            const d = await res.json()
            if (!d || (!d.segments?.length && !d.actions?.length)) {
                throw new Error("Generation returned empty result — check Anthropic credit balance")
            }
            const briefing = {
                segments:     d.segments || d.actions || [],
                title:        d.intent || "Intelligence Briefing",
                generated_at: new Date().toISOString(),
                statistics:   d.statistics,
                threat_overview: d.threat_overview,
                _saved_at:    Date.now(),
            }
            setLastBriefing(briefing)
            try { localStorage.setItem("hw_last_briefing", JSON.stringify(briefing)) } catch {}
            onMarkRead?.()
            refreshDocs()
        } catch (e) {
            setGenerateError(e?.message || "Generation failed — check Anthropic credit balance")
        } finally {
            setGenerating(false)
        }
    }, [onMarkRead, refreshDocs])

    // ── Editor toolbar ────────────────────────────────────────────────────────
    const exec = useCallback((cmd, val = null) => {
        editorRef.current?.focus()
        document.execCommand(cmd, false, val)
    }, [])

    // ── Filter docs for display ───────────────────────────────────────────────
    const displayDocs = (folderId) => {
        return docs.filter(d => d.folder === folderId)
    }

    const canRegen  = (briefingMeta?.can_regenerate ?? true) && countdown <= 0
    const isReadOnly = activeDoc?.read_only ?? true

    // ── Styles ────────────────────────────────────────────────────────────────
    const S = {
        panel: {
            flex: 1, display: "flex", flexDirection: "column", height: "100%",
            background: "rgba(6,14,45,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            overflow: "hidden",
        },
        header: {
            flexShrink: 0, height: 44, display: "flex", alignItems: "center",
            padding: "0 14px", gap: 10,
            borderBottom: "1px solid var(--akili-border)",
        },
        body: { flex: 1, display: "flex", minHeight: 0 },
        sidebar: isMobile
            ? {
                display: mobileSidebarOpen ? "flex" : "none",
                flexDirection: "column", overflowY: "auto",
                width: "100%",
            }
            : {
                width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
                borderRight: "1px solid var(--akili-border)", overflowY: "auto",
            },
        folderRow: (active) => ({
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px 5px 10px", cursor: "pointer",
            background: active ? "rgba(26,110,181,0.1)" : "transparent",
            fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
            color: active ? "var(--akili-accent)" : "var(--akili-text-secondary)",
            userSelect: "none",
        }),
        docRow: (active) => ({
            padding: "6px 10px 6px 26px", cursor: "pointer",
            background: active ? "rgba(26,110,181,0.08)" : "transparent",
            borderLeft: active ? "2px solid var(--akili-accent)" : "2px solid transparent",
            fontSize: 11, color: active ? "var(--akili-text-primary)" : "var(--akili-text-secondary)",
            lineHeight: 1.4, transition: "background 0.08s",
        }),
        content: isMobile
            ? {
                display: mobileSidebarOpen ? "none" : "flex",
                flexDirection: "column", minWidth: 0, overflow: "hidden", flex: 1,
            }
            : {
                flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
            },
        toolbar: {
            flexShrink: 0, height: 36, display: "flex", alignItems: "center",
            gap: 4, padding: "0 14px",
            borderBottom: "1px solid var(--akili-border)",
        },
        editor: {
            flex: 1, padding: "20px 22px", overflowY: "auto",
            outline: "none", fontSize: 13, lineHeight: 1.7,
            color: "var(--akili-text-primary)",
            caretColor: "var(--akili-accent)",
        },
    }

    return (
        <div style={S.panel}>

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div style={S.header}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--akili-accent)" strokeWidth="1.4" strokeLinecap="round">
                    <rect x="2" y="1" width="12" height="14" rx="1.5"/>
                    <line x1="5" y1="5" x2="11" y2="5"/>
                    <line x1="5" y1="8" x2="11" y2="8"/>
                    <line x1="5" y1="11" x2="8.5" y2="11"/>
                </svg>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--akili-text-secondary)" }}>
                    Documents
                </span>

                {/* Search */}
                <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search documents…"
                    style={{
                        flex: 1, height: 26, background: "var(--akili-input-bg)",
                        border: "1px solid var(--akili-input-border)", borderRadius: 4,
                        color: "var(--akili-text-primary)", fontSize: 11,
                        padding: "0 10px", outline: "none", fontFamily: "inherit",
                    }}
                />

                {/* New document */}
                <button
                    onClick={handleNewDoc}
                    style={{
                        height: 26, padding: "0 10px", fontSize: 10, fontWeight: 700,
                        letterSpacing: "0.05em", background: "rgba(26,110,181,0.15)",
                        color: "var(--akili-accent)", border: "1px solid rgba(26,110,181,0.35)",
                        borderRadius: 4, cursor: "pointer", flexShrink: 0,
                    }}
                >
                    + New
                </button>

                <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--akili-text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}>
                    ×
                </button>
            </div>

            {/* ── Document sub-tab row ─────────────────────────────────────── */}
            {openDocIds.length > 0 && (() => {
                const closeDocSubTab = (docId) => {
                    setOpenDocIds(prev => {
                        const next = prev.filter(x => x !== docId)
                        if (activeDocId === docId) {
                            const idx = prev.indexOf(docId)
                            const newActive = next[idx] ?? next[idx - 1] ?? next[0] ?? null
                            if (newActive && openDocMeta[newActive]) {
                                loadDoc(newActive, openDocMeta[newActive].folder)
                            } else {
                                setActiveDocId(null)
                                setActiveDoc(null)
                            }
                        }
                        return next
                    })
                }
                const reorderDocSubTabs = (fromIdx, toIdx) => {
                    setOpenDocIds(prev => {
                        const next = [...prev]
                        const [moved] = next.splice(fromIdx, 1)
                        next.splice(toIdx, 0, moved)
                        return next
                    })
                }
                const docSubTabs = openDocIds.map(id => ({
                    id,
                    label: openDocMeta[id]?.title || "Untitled",
                    type: "briefing",
                }))
                return (
                    <div style={{
                        height: 28, flexShrink: 0,
                        display: "flex", alignItems: "stretch",
                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                        background: "rgba(0,0,0,0.18)",
                    }}>
                        <TabBar
                            tabs={docSubTabs}
                            activeTabId={activeDocId}
                            height={28}
                            iconSize={12}
                            onSwitch={id => {
                                if (openDocMeta[id]) loadDoc(id, openDocMeta[id].folder)
                            }}
                            onClose={closeDocSubTab}
                            onNew={handleNewDoc}
                            onReorder={reorderDocSubTabs}
                            canClose={() => true}
                        />
                    </div>
                )
            })()}

            {/* ── Body ────────────────────────────────────────────────────── */}
            <div style={S.body}>

                {/* ── Left sidebar ── */}
                <div style={S.sidebar}>
                    {FOLDERS.map(folder => {
                        const isExp  = expandedFolders.has(folder.id)
                        const fdocs  = displayDocs(folder.id)
                        const count  = fdocs.length
                        return (
                            <div key={folder.id}>
                                {/* Folder row */}
                                <div
                                    style={S.folderRow(selectedFolder === folder.id)}
                                    onClick={() => {
                                        setSelectedFolder(prev => prev === folder.id ? null : folder.id)
                                        setExpandedFolders(prev => {
                                            const next = new Set(prev)
                                            next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id)
                                            return next
                                        })
                                    }}
                                >
                                    <span style={{ color: "var(--akili-accent)", opacity: 0.7 }}>
                                        <ChevronIcon open={isExp} />
                                    </span>
                                    <span style={{ flex: 1 }}>{folder.label}</span>
                                    {count > 0 && (
                                        <span style={{ fontSize: 9, color: "var(--akili-text-muted)", fontWeight: 400 }}>
                                            {count}
                                        </span>
                                    )}
                                </div>

                                {/* Document rows */}
                                {isExp && fdocs.map(doc => (
                                    <div
                                        key={doc.id}
                                        style={S.docRow(doc.id === activeDocId)}
                                        onClick={() => loadDoc(doc.id, doc.folder, doc.title)}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                                {doc.title}
                                            </span>
                                            {doc.type === "director" && (
                                                <span style={{
                                                    fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
                                                    background: "rgba(200,144,64,0.18)", color: "#c89040",
                                                    border: "1px solid rgba(200,144,64,0.35)", borderRadius: 3,
                                                    padding: "0 4px", flexShrink: 0,
                                                }}>DIRECTOR</span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 9, color: "var(--akili-text-muted)", marginTop: 1 }}>
                                            {fmtDate(doc.modified_at)}
                                            {doc.word_count > 0 && ` · ${doc.word_count}w`}
                                        </div>
                                    </div>
                                ))}

                                {/* Empty state for folder */}
                                {isExp && fdocs.length === 0 && !docsLoading && (
                                    <div style={{ padding: "4px 10px 8px 26px", fontSize: 10, color: "var(--akili-text-muted)", fontStyle: "italic" }}>
                                        {folder.id === "claude-briefings" ? "No briefings yet" : "Empty"}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* ── Right: document area ── */}
                <div style={S.content}>

                    {/* Nothing selected — show last briefing if available */}
                    {!activeDoc && !docLoading && lastBriefing && (
                        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                            <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 700, color: "var(--akili-text-secondary)" }}>{lastBriefing.title || "Intelligence Briefing"}</span>
                                <span>{lastBriefing.generated_at ? new Date(lastBriefing.generated_at).toUTCString().slice(0, 22) + " UTC" : ""}</span>
                            </div>
                            {(lastBriefing.segments || []).map((seg, i) => (
                                <div key={i} style={{ marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--akili-text-primary)", marginBottom: 4, letterSpacing: "0.04em" }}>
                                        {seg.title || seg.heading || `Segment ${i + 1}`}
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--akili-text-secondary)", lineHeight: 1.65 }}>
                                        {seg.narrative || seg.text || ""}
                                    </div>
                                </div>
                            ))}
                            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                <button onClick={handleGenerate} disabled={generating}
                                    style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, background: "var(--akili-accent)", color: "#fff", border: "none", borderRadius: 4, cursor: generating ? "default" : "pointer", opacity: generating ? 0.6 : 1 }}>
                                    {generating ? "Generating…" : "Regenerate"}
                                </button>
                                <button onClick={() => { setLastBriefing(null); localStorage.removeItem("hw_last_briefing") }}
                                    style={{ padding: "6px 14px", fontSize: 11, background: "transparent", color: "var(--akili-text-muted)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, cursor: "pointer" }}>
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Nothing selected, no cached briefing */}
                    {!activeDoc && !docLoading && !lastBriefing && (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--akili-text-muted)", padding: 32 }}>
                            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                                <rect x="5" y="3" width="26" height="30" rx="2"/>
                                <line x1="10" y1="11" x2="26" y2="11"/>
                                <line x1="10" y1="17" x2="26" y2="17"/>
                                <line x1="10" y1="23" x2="20" y2="23"/>
                            </svg>
                            <div style={{ textAlign: "center" }}>
                                <div style={{ fontSize: 12, marginBottom: 4 }}>Select a document to view</div>
                                <div style={{ fontSize: 10, lineHeight: 1.5 }}>
                                    Daily briefings generate at 08:00 UTC.
                                    {briefingMeta && !briefingMeta.briefing && <><br />No briefing yet for today.</>}
                                </div>
                            </div>
                            {generateError && (
                                <div style={{
                                    margin: "8px 0",
                                    padding: "8px 12px",
                                    background: "rgba(255,59,48,0.10)",
                                    border: "1px solid rgba(255,59,48,0.35)",
                                    borderRadius: 4,
                                    color: "#ff6b6b",
                                    fontSize: 11,
                                    lineHeight: 1.45,
                                }}>
                                    {generateError}
                                </div>
                            )}
                            {canRegen && (
                                <button
                                    onClick={handleGenerate}
                                    disabled={generating}
                                    style={{
                                        padding: "7px 16px", fontSize: 11, fontWeight: 700,
                                        background: "var(--akili-accent)", color: "#fff", border: "none",
                                        borderRadius: 5, cursor: generating ? "default" : "pointer",
                                        opacity: generating ? 0.6 : 1,
                                    }}
                                >
                                    {generating ? "Generating…" : "Generate Today's Briefing"}
                                </button>
                            )}
                        </div>
                    )}  {/* end !lastBriefing */}

                    {/* Loading */}
                    {docLoading && (
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                                <circle cx="14" cy="14" r="11" stroke="rgba(26,110,181,0.2)" strokeWidth="2"/>
                                <path d="M14 3 A11 11 0 0 1 25 14" stroke="var(--akili-accent)" strokeWidth="2" strokeLinecap="round">
                                    <animateTransform attributeName="transform" type="rotate" from="0 14 14" to="360 14 14" dur="0.8s" repeatCount="indefinite"/>
                                </path>
                            </svg>
                        </div>
                    )}

                    {/* Document loaded */}
                    {activeDoc && !docLoading && (
                        <>
                            {/* Toolbar */}
                            <div style={S.toolbar}>
                                {/* Mobile back button */}
                                {isMobile && (
                                    <button
                                        onClick={() => setMobileSidebarOpen(true)}
                                        style={{ background: "none", border: "none", color: "var(--akili-text-secondary)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 8px 0 0", flexShrink: 0 }}
                                    >←</button>
                                )}
                                {/* Title */}
                                <input
                                    value={editTitle}
                                    onChange={e => { setEditTitle(e.target.value); setIsDirty(true) }}
                                    readOnly={isReadOnly}
                                    placeholder="Untitled"
                                    style={{
                                        flex: 1, height: 26, background: "transparent",
                                        border: "none", outline: "none",
                                        fontSize: 13, fontWeight: 600, color: "var(--akili-text-primary)",
                                        fontFamily: "inherit",
                                    }}
                                />

                                {/* Editor toolbar (user docs only) */}
                                {!isReadOnly && (
                                    <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                                        <TBtn label="B"  title="Bold"         onClick={() => exec("bold")} />
                                        <TBtn label="I"  title="Italic"       onClick={() => exec("italic")} />
                                        <TBtn label="H1" title="Heading 1"    onClick={() => exec("formatBlock", "h2")} />
                                        <TBtn label="H2" title="Heading 2"    onClick={() => exec("formatBlock", "h3")} />
                                        <TBtn label="•"  title="Bullet list"  onClick={() => exec("insertUnorderedList")} />
                                        <TBtn label="—"  title="Clear format" onClick={() => exec("removeFormat")} />
                                        <div style={{ width: 1, height: 16, background: "var(--akili-border)", margin: "0 4px" }} />
                                        <button
                                            onClick={saveDoc}
                                            disabled={!isDirty || saving}
                                            style={{
                                                height: 24, padding: "0 10px", fontSize: 10, fontWeight: 700,
                                                background: isDirty ? "rgba(26,110,181,0.15)" : "transparent",
                                                color: isDirty ? "var(--akili-accent)" : "var(--akili-text-muted)",
                                                border: `1px solid ${isDirty ? "rgba(26,110,181,0.4)" : "transparent"}`,
                                                borderRadius: 4, cursor: isDirty ? "pointer" : "default",
                                            }}
                                        >
                                            {saving ? "Saving…" : saveMsg || "Save"}
                                        </button>
                                        <button
                                            onClick={handleArchive}
                                            title="Archive document"
                                            style={{
                                                height: 24, padding: "0 8px", fontSize: 10,
                                                background: "transparent", color: "var(--akili-text-muted)",
                                                border: "1px solid transparent", borderRadius: 4, cursor: "pointer",
                                            }}
                                        >
                                            Archive
                                        </button>
                                    </div>
                                )}

                                {/* Briefing toolbar (claude-briefings) */}
                                {isReadOnly && activeDoc.folder === "claude-briefings" && activeDoc.type !== "director" && (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                        <span style={{ fontSize: 9, color: "var(--akili-text-muted)" }}>
                                            {fmtDate(activeDoc.created_at)}
                                            {activeDoc.metadata?.tokens_used && ` · ${activeDoc.metadata.tokens_used.toLocaleString()}t`}
                                        </span>
                                        <button
                                            onClick={handleGenerate}
                                            disabled={!canRegen || generating}
                                            style={{
                                                height: 24, padding: "0 10px", fontSize: 10, fontWeight: 700,
                                                background: canRegen && !generating ? "rgba(26,110,181,0.15)" : "transparent",
                                                color: canRegen && !generating ? "var(--akili-accent)" : "var(--akili-text-muted)",
                                                border: `1px solid ${canRegen && !generating ? "rgba(26,110,181,0.4)" : "rgba(255,255,255,0.06)"}`,
                                                borderRadius: 4, cursor: canRegen && !generating ? "pointer" : "default",
                                            }}
                                        >
                                            {generating ? "Generating…" : countdown > 0 ? `Regen in ${fmtCountdown(countdown)}` : "Regenerate"}
                                        </button>
                                    </div>
                                )}

                                {/* Director briefing toolbar */}
                                {isReadOnly && activeDoc.type === "director" && (
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, letterSpacing: "0.07em",
                                            color: "#c89040", background: "rgba(200,144,64,0.12)",
                                            border: "1px solid rgba(200,144,64,0.3)", borderRadius: 3,
                                            padding: "1px 6px",
                                        }}>DIRECTOR</span>
                                        <span style={{ fontSize: 9, color: "var(--akili-text-muted)" }}>
                                            {fmtDate(activeDoc.created_at)}
                                        </span>
                                        {onReplay && (
                                            <button
                                                onClick={() => onReplay(activeDoc)}
                                                style={{
                                                    height: 24, padding: "0 10px", fontSize: 10, fontWeight: 700,
                                                    background: "rgba(200,144,64,0.15)", color: "#c89040",
                                                    border: "1px solid rgba(200,144,64,0.4)", borderRadius: 4,
                                                    cursor: "pointer", letterSpacing: "0.04em",
                                                }}
                                            >
                                                ▶ Replay
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Content area */}
                            {isReadOnly ? (
                                /* Briefing viewer */
                                <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
                                    <BriefingSections content={activeDoc.content} />
                                </div>
                            ) : (
                                /* User doc editor */
                                <div
                                    ref={editorRef}
                                    contentEditable
                                    suppressContentEditableWarning
                                    onInput={() => setIsDirty(true)}
                                    style={{
                                        ...S.editor,
                                        // Inline styles for headings generated by execCommand
                                    }}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Editor styles */}
            <style>{`
                [contenteditable] h2 { font-size: 16px; font-weight: 700; margin: 12px 0 6px; color: var(--akili-text-primary); }
                [contenteditable] h3 { font-size: 14px; font-weight: 600; margin: 10px 0 5px; color: var(--akili-text-primary); }
                [contenteditable] ul { padding-left: 18px; margin: 6px 0; }
                [contenteditable] li { margin-bottom: 4px; }
                [contenteditable] strong { font-weight: 700; }
                [contenteditable] em { font-style: italic; }
                [contenteditable]:empty:before { content: attr(placeholder); color: var(--akili-text-muted); pointer-events: none; }
                [contenteditable]:focus { outline: none; }
            `}</style>
        </div>
    )
}

// ── Exported helper: save a Claude analysis to Saved Analysis folder ───────────
export async function saveAnalysisToDocuments(headline, markdownContent) {
    try {
        const r = await fetch(`${API}/api/documents`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                folder:  "saved-analysis",
                title:   headline || "Saved Analysis",
                content: markdownContent || "",
                metadata: { saved_from: "detail_panel" },
            }),
        })
        return r.ok ? await r.json() : null
    } catch {
        return null
    }
}

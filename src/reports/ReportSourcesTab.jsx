/**
 * Sourced-articles tab — adapted from ForgePanel.jsx's TaskSourcesTab
 * (~line 2101-2114), restyled with Round 1 tokens.
 *
 * Props:
 *   collected — the task's real `collected` object (top_articles[] with
 *               {url, title, article_type, tier, relevance_score, ...}).
 */
export default function ReportSourcesTab({ collected }) {
    const articles = collected?.top_articles || []
    return (
        <div style={{ maxWidth: 640, fontFamily: "var(--font-sans)" }}>
            {articles.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No sourced articles collected yet.</div>
            )}
            {articles.map((a, i) => (
                <div key={a.url || i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-dim)" }}>
                    <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--text-link)", fontSize: "var(--text-sm)", textDecoration: "none" }}
                    >
                        {a.title || a.url}
                    </a>
                    <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginTop: 2 }}>
                        {a.article_type || "—"} · tier {a.tier ?? "—"} · relevance {a.relevance_score ?? "—"}
                    </div>
                </div>
            ))}
        </div>
    )
}

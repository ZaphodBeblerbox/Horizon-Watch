/**
 * RiskFamilyBreakdown.jsx — which sources put a country where it is.
 *
 * Four rows, one per source family (GDELT, News (RSS), Telegram,
 * GeoConfirmed): the family's own 0–100 reading, what it counted and over
 * which window, whether it agrees the country is elevated, and how many
 * points of the index it carried. Under them, the sentence the backend
 * writes on agreement, and the cap when one or two families alone were not
 * allowed to carry the country higher.
 */
import { familyRows, agreementText } from "../lib/riskFamilies.js"

const ROW = { display: "grid", gridTemplateColumns: "92px minmax(0,1fr) 38px", gap: 8, alignItems: "center", padding: "5px 0" }
const SMALL = { font: "400 10px var(--font)", color: "var(--text-dim, var(--txt3))" }

export default function RiskFamilyBreakdown({ country, compact = false }) {
    if (!country?.families) return null
    const rows = familyRows(country)
    return (
        <div className="risk-families" data-testid="risk-families">
            {rows.map((r) => (
                <div key={r.key} style={{ borderBottom: "1px solid var(--line-soft, var(--gline))" }}>
                    <div style={ROW}>
                        <span style={{ font: "600 11px var(--font)", color: "var(--text-primary, var(--txt))" }}>
                            {r.label}
                            {r.corroborates && (
                                <span title="This family agrees the country is elevated"
                                      style={{ marginLeft: 5, font: "600 9px var(--font)", color: "var(--text-secondary, var(--txt2))" }}>
                                    ✓
                                </span>
                            )}
                        </span>
                        <span style={{ height: 5, background: "var(--line-soft, var(--gline))", position: "relative" }}>
                            {r.score != null && (
                                <i style={{ position: "absolute", inset: 0, width: `${Math.max(2, r.score)}%`,
                                            background: r.corroborates ? "var(--text-primary, var(--txt))" : "var(--text-dim, var(--txt3))" }} />
                            )}
                        </span>
                        <b style={{ font: "600 11px var(--font)", textAlign: "right",
                                    color: r.score == null ? "var(--text-dim, var(--txt3))" : "var(--text-primary, var(--txt))" }}>
                            {r.score == null ? "—" : Math.round(r.score)}
                        </b>
                    </div>
                    {!compact && (
                        <div style={{ ...SMALL, padding: "0 0 5px" }}>
                            {r.summary}
                            {r.windowDays ? ` · ${r.windowDays}d` : ""}
                            {r.contribution != null ? ` · ${r.contribution.toFixed(1)} pts of the index` : ""}
                        </div>
                    )}
                </div>
            ))}
            <div style={{ ...SMALL, paddingTop: 6 }}>
                {agreementText(country)}
                {country.confidence ? ` · ${country.confidence} confidence` : ""}
                {country.capped && country.uncapped_score != null
                    ? ` · held at ${country.score?.toFixed?.(1)} (would be ${country.uncapped_score.toFixed(1)}) until more sources agree`
                    : ""}
            </div>
            {country.explanation && !compact && (
                <div style={{ font: "400 11px var(--font)", color: "var(--text-secondary, var(--txt2))", paddingTop: 4 }}>
                    {country.explanation}
                </div>
            )}
        </div>
    )
}

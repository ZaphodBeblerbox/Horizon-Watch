/**
 * MapAnnobar.jsx — PARALLAX spec §10.1. The map toolbar: top-left, vertical,
 * 28px buttons, on the map surface.
 *
 * This REPLACES the previous placement. The earlier build deliberately put
 * these controls in a 28px header band above the map, with a comment saying
 * they must "never float on the map surface" — that was correct for the
 * layout it was written against, where the side panes were translucent
 * overlays and a floating control could end up unclickable underneath one.
 * The panes are opaque and laid out as grid columns now, and §10 is explicit:
 * `.annobar` sits inside `#mapwrap`, top-left, vertical.
 *
 * ⚠ ONE IMAGERY ICON, NOT TWO. The spec calls this out by name: the old build
 * had separate `scanbox` and `scanpoly` tools. Geometry is now chosen inside
 * the imagery panel, before you draw, so there is a single `#t-imagery`
 * control here. The two old tools are kept as hidden stubs only because the
 * draw code still dispatches on them.
 *
 * Two kinds of button share one shell and must not be conflated:
 *   - TOOLS (select/measure/pin/poly) are a single-select mode. Exactly one is
 *     active; clicking another switches.
 *   - TOGGLES (#t-imagery/#t-grat/#t-label) are independent on/off.
 *
 * §10.1 lists a fourth toggle, #t-risk. It is absent because the layer it
 * drove (GlobeThreatHeatmapLayer) has been removed: it drew 1° grid
 * rectangles over ten hardcoded region bboxes and, separately, a dot per
 * active alert — which in practice meant several thousand sanctioned-vessel
 * dots landing on the map the moment the toggle was pressed. A toggle kept
 * for spec-completeness with nothing behind it is worse than an absent one,
 * so it is gone until a real per-country choropleth exists to put there.
 * They are rendered from separate lists rather than one list with a flag,
 * because a single list invites the next edit to make a toggle exclusive.
 *
 * A third kind, the BASEMAP switch, is one-of-three and acts on the map
 * rather than on a tool. It is a labelled segment, not three more glyphs:
 * two of the three basemap icons are borrowed from other controls, and an
 * unlabelled basemap button is exactly what got reported as "no option to
 * change map". It drives the same state as MapChrome's picker, from the
 * same BASEMAPS list, so the two can never disagree.
 */
import { BASEMAPS } from "./MapChrome.jsx"

const TOOLS = [
    { key: "select",  icon: "i-cursor",  title: "Select" },
    { key: "measure", icon: "i-measure", title: "Measure distance" },
    { key: "pin",     icon: "i-pin",     title: "Drop annotation" },
    { key: "poly",    icon: "i-poly",    title: "Draw area" },
]

const TOGGLES = [
    { key: "imagery", id: "t-imagery", icon: "i-sat",   title: "Imagery detection" },
    { key: "grat",    id: "t-grat",    icon: "i-grid",  title: "Graticule" },
    { key: "label",   id: "t-label",   icon: "i-label", title: "Marker labels" },
]

function Btn({ id, icon, title, on, onClick, disabled = false }) {
    return (
        <button
            id={id}
            className={`tool${on ? " on" : ""}`}
            onClick={onClick}
            title={title}
            aria-label={title}
            aria-pressed={on}
            disabled={disabled}
        >
            <svg aria-hidden="true"><use href={`#${icon}`} /></svg>
        </button>
    )
}

export default function MapAnnobar({
    tool = "select",
    onToolChange,
    toggles = {},
    onToggle,
    disabledToggles = {},
    basemap = null,
}) {
    return (
        <div className="annobar" role="toolbar" aria-orientation="vertical" aria-label="Map tools">
            {TOOLS.map((t) => (
                <Btn
                    key={t.key}
                    id={`tool-${t.key}`}
                    icon={t.icon}
                    title={t.title}
                    on={tool === t.key}
                    onClick={() => onToolChange && onToolChange(t.key)}
                />
            ))}
            <i className="annosep" aria-hidden="true" />
            {TOGGLES.map((t) => (
                <Btn
                    key={t.key}
                    id={t.id}
                    icon={t.icon}
                    title={disabledToggles[t.key] ? `${t.title} — unavailable` : t.title}
                    on={!!toggles[t.key]}
                    disabled={!!disabledToggles[t.key]}
                    onClick={() => onToggle && onToggle(t.key)}
                />
            ))}
            {basemap && (
                <>
                    <i className="annosep" aria-hidden="true" />
                    <div className="annoseg" role="radiogroup" aria-label="Map type">
                        {BASEMAPS.map((b) => (
                            <button
                                key={b.key}
                                id={`bm-${b.key}`}
                                className={`tool seg${basemap.value === b.key ? " on" : ""}`}
                                role="radio"
                                aria-checked={basemap.value === b.key}
                                title={b.hint}
                                onClick={() => basemap.onChange && basemap.onChange(b.key)}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
            {/* Hidden stubs — see the header note. Present only so draw code
                that dispatches on these tool ids keeps resolving; never shown. */}
            <button className="tool hidden" data-tool="scanbox" aria-hidden="true" tabIndex={-1} />
            <button className="tool hidden" data-tool="scanpoly" aria-hidden="true" tabIndex={-1} />
        </div>
    )
}

import {
    Plane, Ship, MapPin, Satellite, Building2, TriangleAlert, Lock, Ruler, Camera,
    Bell, Layers, SlidersHorizontal, Target, ZoomIn, ZoomOut, Maximize, Pencil,
    Save, Send, Upload, Download, Clipboard, LayoutDashboard, FileText, Radio,
    Sparkles, Search, Settings, User, ChevronRight, X, Menu, Home, Locate,
    RotateCcw, ExternalLink, Check, ArrowUpRight, PlaneTakeoff, Anchor, Cable,
    Moon, Mountain,
} from "lucide-react"

/**
 * The one shared icon set for the whole app (full UI rebuild spec, section 2)
 * — thin 1.5px stroke, geometric, outline-only, never filled/cartoon. This
 * explicitly replaces src/globe/markerRenderer.js's MIL-STD-2525-style
 * affiliation-frame system for all UI-chrome icon use; entity-on-globe
 * markers are a separate concern (see src/globe/entityIcons.js) since those
 * render onto Cesium canvas billboards, not React DOM.
 *
 * Every icon in the app should render through this component, not a raw
 * lucide-react import, so the stroke width / default size stay uniform in
 * one place per the spec ("16px default size, 18px when used in the
 * header").
 */
const ICONS = {
    aircraft: Plane,
    vessel: Ship,
    poi: MapPin,
    satellite: Satellite,
    facility: Building2,
    // Real, distinct search-result-type icons (TopBar.jsx's InlineSearch /
    // GlobalSearch.jsx dropdown rows) — replacing that table's old raw emoji
    // (✈⚓〰) with real lucide glyphs rather than force-fitting every
    // infrastructure type into the generic "facility" icon above, which
    // would make airport/port/cable results visually indistinguishable in
    // a list that shows all three at once.
    airport: PlaneTakeoff,
    port: Anchor,
    cable: Cable,
    warning: TriangleAlert,
    lock: Lock,
    ruler: Ruler,
    camera: Camera,
    bell: Bell,
    layers: Layers,
    filter: SlidersHorizontal,
    target: Target,
    zoomIn: ZoomIn,
    zoomOut: ZoomOut,
    expand: Maximize,
    edit: Pencil,
    save: Save,
    submit: Send,
    upload: Upload,
    download: Download,
    clipboard: Clipboard,
    dashboard: LayoutDashboard,
    reports: FileText,
    sources: Radio,
    aiCouncil: Sparkles,
    search: Search,
    settings: Settings,
    user: User,
    chevronRight: ChevronRight,
    close: X,
    menu: Menu,
    home: Home,
    locate: Locate,
    refresh: RotateCcw,
    externalLink: ExternalLink,
    check: Check,
    jumpTo: ArrowUpRight,
    basemapDark: Moon,
    basemapTerrain: Mountain,
}

export const ICON_NAMES = Object.keys(ICONS)

export default function Icon({ name, size = 16, color = "currentColor", strokeWidth = 1.5, style, ...rest }) {
    const Cmp = ICONS[name]
    if (!Cmp) return null
    return <Cmp size={size} color={color} strokeWidth={strokeWidth} style={style} {...rest} />
}

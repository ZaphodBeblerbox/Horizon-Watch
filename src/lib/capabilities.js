// capabilities.js — the real five-role capability model (Horizon Watch V3
// Phase 1, §7.3). Real per-request authentication now exists (real
// authentication round, backend/main.py's /api/auth/* + a real bcrypt-
// hashed users table) — see src/state/authStore.js for the real session
// state this file now reads identity from.
//
// currentAccessRole()/currentUserId() prefer the real authenticated
// session's real capability_role/id; the old self-reported profile
// (accessRole/userId in MissionProfilePanel.jsx) is now only a pre-login
// fallback, kept so report approve/reject/publish and ontology claim
// approve/reject (not yet migrated to server-side enforcement in this
// round — real auth existing doesn't retroactively protect routes nobody
// has wired to it yet) keep working exactly as before. Case-approval
// advance and RFI answer ARE now enforced server-side against the real
// session (backend/main.py's _require_capability_real()/
// _require_current_user()) — `can()`/`requireCapability()` here still
// gate the UI (so an unauthorized user gets a real, explained refusal
// without ever making the doomed request), but the server no longer
// trusts the client's word for those two routes.

export const ACCESS_ROLES = {
    security_lead:    { label: "Security lead",    capabilities: ["approve", "issue", "assign", "brief", "admin"] },
    senior_analyst:   { label: "Senior analyst",   capabilities: ["assign", "brief", "review"] },
    analyst:          { label: "Analyst",          capabilities: ["brief"] },
    regional_lead:    { label: "Regional lead",    capabilities: ["answer", "brief"] },
    imagery_analyst:  { label: "Imagery analyst",  capabilities: ["confirm", "brief"] },
}

export const ACCESS_ROLE_IDS = Object.keys(ACCESS_ROLES)
export const DEFAULT_ACCESS_ROLE = "analyst"

// Human-readable explanation for a refusal toast — capability -> what it's
// for, so "you can't do that" always comes with a real reason, never a bare
// denial.
const CAPABILITY_LABELS = {
    approve: "approve reports",
    issue:   "issue/publish reports",
    assign:  "assign work to others",
    brief:   "add records to a briefing",
    admin:   "perform administrative actions",
    review:  "review submitted work",
    answer:  "answer requests for information",
    confirm: "confirm imagery detections",
}

export function roleLabel(accessRole) {
    return ACCESS_ROLES[accessRole]?.label || accessRole || "Unknown role"
}

export function roleHasCapability(accessRole, capability) {
    return !!ACCESS_ROLES[accessRole]?.capabilities?.includes(capability)
}

export function capabilityLabel(capability) {
    return CAPABILITY_LABELS[capability] || capability
}

// ── The real gate ──────────────────────────────────────────────────────
// Real authentication round: identity now comes from the real
// authenticated session (src/state/authStore.js — a real backend user row,
// resolved server-side from a verified JWT cookie) when one exists, since
// that's real per-request-verifiable identity rather than a self-reported
// client value. Falls back to the old self-reported profile ONLY when
// nothing is logged in — this keeps report approve/reject/publish and
// ontology claim approve/reject (still real-but-client-side-only; server-
// side enforcement for those is a real follow-up, not done in this round)
// working exactly as before for now, without silently breaking them.

import { loadProfile } from "../constants/profile.js"
import { getCurrentUser } from "../state/authStore.js"
import { toast } from "../ui/toast.js"

export function currentAccessRole() {
    const u = getCurrentUser()
    if (u && ACCESS_ROLES[u.capability_role]) return u.capability_role
    const p = loadProfile()
    return (p && ACCESS_ROLES[p.accessRole]) ? p.accessRole : DEFAULT_ACCESS_ROLE
}

// Real link to a real backend users.id — the authenticated session's own
// real id when logged in (the case the Cases/RFI gating this feeds
// actually depends on being real), the old self-reported profile.userId
// only as a pre-login fallback.
export function currentUserId() {
    const u = getCurrentUser()
    if (u?.id) return u.id
    const p = loadProfile()
    return p?.userId || null
}

export function can(capability) {
    return roleHasCapability(currentAccessRole(), capability)
}

// Real, disclosed refusal — never a silently hidden control. Call this at
// the point of use: `if (!can('approve')) { refuse('approve'); return }`.
// Returns whether the action is allowed, so callers can guard in one line.
export function requireCapability(capability) {
    if (can(capability)) return true
    const role = roleLabel(currentAccessRole())
    // Real sprite symbol id (src/ui/IconSprite.jsx has no lock/shield glyph;
    // i-eye-off is the closest real "not permitted to you" glyph already in
    // the sprite — checked before using it, not guessed like the pre-existing
    // "icon-eye-off"/"icon-check" toast calls elsewhere, which reference
    // symbol ids that don't actually exist in the sprite).
    toast(`${role} cannot ${capabilityLabel(capability)} — this action needs a role with that capability.`, { icon: "i-eye-off" })
    return false
}

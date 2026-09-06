// capabilities.js — the real five-role capability model (Horizon Watch V3
// Phase 1, §7.3). Confirmed via audit before writing this: real auth/login
// was deliberately deleted from this codebase (commit 189d706 — "delete
// backend login/role/permission system entirely"); `User.role` still exists
// as a DB column but nothing reads it; the ONE real "who is using this app"
// concept left is the single shared profile (localStorage `akili-profile-v1`
// on the client, `backend/profile.json` on the server) — not per-user, not
// authenticated, cannot represent more than one identity at a time.
//
// Given that reality, this does NOT rebuild real multi-user authentication
// (a far bigger, separate project) and does NOT seed fake demo users. It
// adds one real, minimal thing to the one real identity record that exists:
// an `accessRole` field, editable in MissionProfilePanel.jsx exactly like
// the existing `role` (mission-focus) field already is. "Switching role"
// today means "changing what your own single profile is currently allowed
// to do," not "logging in as someone else" — that limitation is real and
// stays disclosed, not hidden behind seeded identities that would pretend
// otherwise.
//
// Capability enforcement here is real but client-side only: there is no
// live per-request server auth to check against (the backend endpoints
// this gates — report approve/reject/publish, ontology claim approve/
// reject — currently accept any caller, a direct, disclosed consequence of
// the same auth removal). Real server-side enforcement is a follow-up that
// depends on real auth existing again, not something this phase can
// honestly claim to deliver.

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
// Reads the live profile fresh on every call (a plain localStorage read,
// not a cached/stale copy) so `can()` always reflects whatever role the
// analyst most recently set in MissionProfilePanel — no separate store to
// fall out of sync with the one real profile record.

import { loadProfile } from "../constants/profile.js"
import { toast } from "../ui/toast.js"

export function currentAccessRole() {
    const p = loadProfile()
    return (p && ACCESS_ROLES[p.accessRole]) ? p.accessRole : DEFAULT_ACCESS_ROLE
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

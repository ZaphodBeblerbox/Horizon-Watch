// Real, minimal geometric mark — this app has no actual brand logo asset
// anywhere in the repo (this file was previously a no-op stub, `() => null`,
// which left the header's "20px icon mark" slot genuinely empty). Rather
// than fabricate a fake brand logo image, this renders a simple, honest
// abstract mark (a targeting-reticle motif, fitting an intelligence/
// surveillance product) using only real design tokens — no invented
// branding, just a real, visible icon-mark-sized element.
export default function Logo({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8" stroke="var(--accent-blue)" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="2.5" fill="var(--accent-blue)" />
            <line x1="10" y1="0.5" x2="10" y2="4" stroke="var(--accent-blue)" strokeWidth="1.5" />
            <line x1="10" y1="16" x2="10" y2="19.5" stroke="var(--accent-blue)" strokeWidth="1.5" />
            <line x1="0.5" y1="10" x2="4" y2="10" stroke="var(--accent-blue)" strokeWidth="1.5" />
            <line x1="16" y1="10" x2="19.5" y2="10" stroke="var(--accent-blue)" strokeWidth="1.5" />
        </svg>
    )
}

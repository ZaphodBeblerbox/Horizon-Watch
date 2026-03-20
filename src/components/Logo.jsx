const Logo = ({ size = 120 }) => (
    <svg width={size} height={size * 0.6} viewBox="0 0 120 72" xmlns="http://www.w3.org/2000/svg">
        {/* Horizon line */}
        <line x1="0" y1="52" x2="120" y2="52" stroke="#0d9488" strokeWidth="1.5" opacity="0.8"/>

        {/* Sun arc — semicircle rising above horizon */}
        <path d="M 30 52 A 30 30 0 0 1 90 52"
              stroke="#0d9488" strokeWidth="1.8" fill="none" opacity="0.9"/>

        {/* Sun centre glow */}
        <circle cx="60" cy="52" r="8" fill="#0d9488" opacity="0.9"/>
        <circle cx="60" cy="52" r="5" fill="#14b8a6" opacity="1"/>
        <circle cx="60" cy="52" r="2.5" fill="#e8edf2"/>

        {/* Sun rays — radiating outward above horizon */}
        <line x1="60" y1="18" x2="60" y2="26" stroke="#0d9488" strokeWidth="1.5" opacity="0.7"/>
        <line x1="35" y1="27" x2="40" y2="33" stroke="#0d9488" strokeWidth="1.5" opacity="0.6"/>
        <line x1="85" y1="27" x2="80" y2="33" stroke="#0d9488" strokeWidth="1.5" opacity="0.6"/>
        <line x1="22" y1="44" x2="30" y2="46" stroke="#0d9488" strokeWidth="1.5" opacity="0.5"/>
        <line x1="98" y1="44" x2="90" y2="46" stroke="#0d9488" strokeWidth="1.5" opacity="0.5"/>
        <line x1="28" y1="34" x2="34" y2="39" stroke="#0d9488" strokeWidth="1" opacity="0.4"/>
        <line x1="92" y1="34" x2="86" y2="39" stroke="#0d9488" strokeWidth="1" opacity="0.4"/>

        {/* Horizon glow */}
        <ellipse cx="60" cy="52" rx="35" ry="6"
                 fill="url(#horizonGlow)" opacity="0.4"/>

        {/* Earth curve below horizon */}
        <path d="M 0 52 Q 60 62 120 52"
              stroke="#0d9488" strokeWidth="0.8" fill="none" opacity="0.25"/>

        {/* Latitude lines on arc suggesting globe */}
        <path d="M 36 52 A 24 24 0 0 1 84 52"
              stroke="#0d9488" strokeWidth="0.7" fill="none" opacity="0.2"/>
        <path d="M 44 52 A 16 16 0 0 1 76 52"
              stroke="#0d9488" strokeWidth="0.7" fill="none" opacity="0.15"/>

        <defs>
            <radialGradient id="horizonGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#0d9488" stopOpacity="1"/>
                <stop offset="100%" stopColor="#0d9488" stopOpacity="0"/>
            </radialGradient>
        </defs>
    </svg>
)

export default Logo

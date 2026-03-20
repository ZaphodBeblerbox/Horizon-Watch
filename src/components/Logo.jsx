const Logo = ({ size = 48 }) => {
    const w = size * 1.6
    const h = size
    return (
        <svg width={w} height={h} viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg">
            {/* Horizon line */}
            <line x1="0" y1="35" x2="80" y2="35" stroke="white" strokeWidth="1.2" opacity="0.9"/>

            {/* Sun rays — clean straight lines radiating upward */}
            <line x1="40" y1="6"  x2="40" y2="14" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="22" y1="11" x2="26" y2="18" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="58" y1="11" x2="54" y2="18" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="10" y1="24" x2="16" y2="27" stroke="white" strokeWidth="1"   strokeLinecap="round" opacity="0.8"/>
            <line x1="70" y1="24" x2="64" y2="27" stroke="white" strokeWidth="1"   strokeLinecap="round" opacity="0.8"/>
            <line x1="4"  y1="35" x2="11" y2="35" stroke="white" strokeWidth="1"   opacity="0.5"/>
            <line x1="76" y1="35" x2="69" y2="35" stroke="white" strokeWidth="1"   opacity="0.5"/>

            {/* Sun semicircle — clean arc sitting on the horizon */}
            <path d="M 22 35 A 18 18 0 0 1 58 35" stroke="white" strokeWidth="1.6" fill="none"/>

            {/* Sun centre — filled circle on the horizon */}
            <circle cx="40" cy="35" r="5"   fill="white"/>
            <circle cx="40" cy="35" r="2.5" fill="#0a1628"/>

            {/* Subtle reflection below horizon */}
            <line x1="0" y1="35" x2="80" y2="35" stroke="white" strokeWidth="0.4" opacity="0.2" transform="translate(0,4)"/>
        </svg>
    )
}

export default Logo

const Logo = ({ size = 48 }) => {
    const w = size * 1.8, h = size
    return (
        <svg width={w} height={h} viewBox="0 0 90 50" xmlns="http://www.w3.org/2000/svg">
            <path d="M 0 42 Q 45 52 90 42" stroke="white" strokeWidth="1.2" fill="none" opacity="0.6"/>
            <line x1="0" y1="38" x2="90" y2="38" stroke="white" strokeWidth="1.5" opacity="0.9"/>
            <line x1="45" y1="4"  x2="45" y2="13" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="25" y1="9"  x2="29" y2="17" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="65" y1="9"  x2="61" y2="17" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="10" y1="24" x2="17" y2="27" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.8"/>
            <line x1="80" y1="24" x2="73" y2="27" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.8"/>
            <line x1="3"  y1="35" x2="12" y2="36" stroke="white" strokeWidth="1"   strokeLinecap="round" opacity="0.6"/>
            <line x1="87" y1="35" x2="78" y2="36" stroke="white" strokeWidth="1"   strokeLinecap="round" opacity="0.6"/>
            <path d="M 24 38 A 21 21 0 0 1 66 38" stroke="white" strokeWidth="1.8" fill="none"/>
            <ellipse cx="45" cy="38" rx="9" ry="5.5" stroke="white" strokeWidth="1.4" fill="none"/>
            <circle cx="45" cy="38" r="3" fill="white"/>
            <circle cx="45" cy="38" r="1.2" fill="#060d1a"/>
            <circle cx="43.5" cy="36.8" r="0.7" fill="white" opacity="0.9"/>
        </svg>
    )
}

export default Logo

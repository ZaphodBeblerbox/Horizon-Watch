const Logo = ({ size = 48 }) => (
    <svg width={size * 1.6} height={size} viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg">
        {/* Eye outline */}
        <path d="M 5 25 Q 40 2 75 25 Q 40 48 5 25 Z"
              stroke="white" strokeWidth="1.8" fill="none"/>
        {/* Iris */}
        <circle cx="40" cy="25" r="10" stroke="white" strokeWidth="1.5" fill="none"/>
        {/* Pupil */}
        <circle cx="40" cy="25" r="4.5" fill="white"/>
        <circle cx="40" cy="25" r="1.8" fill="#060d1a"/>
        {/* Highlight */}
        <circle cx="37" cy="22" r="1.2" fill="white" opacity="0.8"/>
        {/* Lashes top */}
        <line x1="40" y1="13" x2="40" y2="16" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
        <line x1="52" y1="16" x2="50" y2="18.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
        <line x1="28" y1="16" x2="30" y2="18.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
    </svg>
)
export default Logo

import { useState, useEffect } from "react"

export function useMobile() {
    const [isMobile,   setIsMobile]   = useState(() => window.innerWidth < 768)
    const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth)

    useEffect(() => {
        const handle = () => {
            setIsMobile(window.innerWidth < 768)
            setIsPortrait(window.innerHeight > window.innerWidth)
        }
        window.addEventListener("resize", handle)
        window.addEventListener("orientationchange", handle)
        return () => {
            window.removeEventListener("resize", handle)
            window.removeEventListener("orientationchange", handle)
        }
    }, [])

    return { isMobile, isPortrait }
}

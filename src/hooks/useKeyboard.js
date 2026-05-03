import { useEffect, useRef } from "react"

export function useKeyboard(handlers) {
    const handlersRef = useRef(handlers)
    useEffect(() => { handlersRef.current = handlers })

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return
            const handler = handlersRef.current[e.key]
            if (handler) handler(e)
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])
}

// The Strikes & control layer's chosen acts and time window (strikes.js), as a hook.
import { useEffect, useState } from "react"
import { strikeSettings, subscribeStrikeSettings } from "./strikes.js"

export function useStrikeSettings() {
    const [s, setS] = useState(strikeSettings)
    useEffect(() => subscribeStrikeSettings(setS), [])
    return s
}

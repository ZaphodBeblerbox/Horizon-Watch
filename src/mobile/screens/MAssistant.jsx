/**
 * MAssistant.jsx — the assistant on the phone: the same conversation as the
 * desktop panel (src/assistant/AssistantThread.jsx), full height over the
 * map, glass and monochrome like the rest of the phone. A fly sends the
 * phone to the map (MobileApp listens for m2:assistant-fly) and a chip there
 * brings it back here.
 */
import AssistantThread from "../../assistant/AssistantThread.jsx"

export default function MAssistant() {
    return (
        <div className="m2-scroll" style={{
            // between the phone's header and tab bar (both float over the body)
            paddingLeft: 0, paddingRight: 0, paddingTop: "calc(var(--m2-top-h, 60px) + 2px)",
            paddingBottom: "calc(var(--m2-nav-h, 58px) + env(safe-area-inset-bottom, 0px) + 4px)",
            overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <AssistantThread platform="phone" title="Conversation" autoFocus={false} />
        </div>
    )
}

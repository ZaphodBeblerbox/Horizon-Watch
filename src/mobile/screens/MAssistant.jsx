/**
 * MAssistant.jsx — the assistant on the phone: the same conversation as the
 * desktop panel (src/assistant/AssistantThread.jsx), full height over the
 * map, glass and monochrome like the rest of the phone. A fly sends the
 * phone to the map (MobileApp listens for m2:assistant-fly) and a chip there
 * brings it back here.
 */
import AssistantThread from "../../assistant/AssistantThread.jsx"

export default function MAssistant({ mode = null }) {
    return (
        <div className="m2-scroll" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
            <AssistantThread platform="phone" mode={mode} title="Ask Parallax" autoFocus={false} />
        </div>
    )
}

// "Write a post" in the Inspector, as an inspector extension (inspector/extensionRegistry.js):
// registered once at load, rendered by the Inspector itself under the item.
import { registerInspectorExtension } from "../inspector/extensionRegistry.js"
import { WritePostExtension } from "./WritePostButton.jsx"

registerInspectorExtension(WritePostExtension)

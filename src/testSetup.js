// Tests pin formats in Zulu, so a run does not depend on the machine's time
// zone; the local-time tests set their own zone (utils/formatTime.test.js).
import { __setClock } from "./utils/clock.js"
__setClock({ mode: "utc" })

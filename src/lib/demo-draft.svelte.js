// The drop a visitor builds on /demo, handed to /demo/live. Lives in memory only: the demo never touches a server.
import { DEMO_DEFAULTS } from './sim.js'

export const draft = $state({ cfg: { ...DEMO_DEFAULTS } })

// Hitmarker "ding": a 70ms square blip from WebAudio. No audio files to load. Off until the viewer opts in.

const MIN_GAP_MS = 60 // past ~16 dings/sec it becomes noise
let ctx = null
let last = 0

export function unlockSound() {
  ctx ??= new AudioContext()
  return ctx.resume()
}

export function ding() {
  const now = performance.now()
  if (!ctx || now - last < MIN_GAP_MS) return
  last = now
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1760, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.07)
  gain.gain.setValueAtTime(0.06, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.08)
}

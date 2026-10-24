import { describe, expect, it } from 'vitest'
import { utcToZoned, zonedToUtc } from '../src/lib/time.js'

describe('zoned time', () => {
  it('converts wall time in a zone to the right instant, across DST', () => {
    expect(new Date(zonedToUtc('2026-07-01T21:00', 'America/Los_Angeles')).toISOString()).toBe('2026-07-02T04:00:00.000Z') // PDT
    expect(new Date(zonedToUtc('2026-12-01T21:00', 'America/Los_Angeles')).toISOString()).toBe('2026-12-02T05:00:00.000Z') // PST
    expect(new Date(zonedToUtc('2026-11-01T00:30', 'Asia/Kolkata')).toISOString()).toBe('2026-10-31T19:00:00.000Z')
  })

  it('round-trips for the editor', () => {
    for (const z of ['UTC', 'Europe/London', 'Australia/Sydney', 'America/New_York']) {
      expect(utcToZoned(zonedToUtc('2026-03-29T09:15', z), z)).toBe('2026-03-29T09:15')
    }
  })
})

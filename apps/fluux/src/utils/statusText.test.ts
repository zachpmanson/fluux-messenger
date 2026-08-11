import { describe, it, expect } from 'vitest'
import { getTranslatedStatusText } from './statusText'
import type { Contact } from '@fluux/sdk'

// Minimal mock translation function that returns the key with interpolated values
function t(key: string, opts?: Record<string, unknown>): string {
  if (opts?.count !== undefined) return `${key}:${opts.count}`
  if (opts?.time !== undefined) return `${key}:${opts.time}`
  return key
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    jid: 'user@example.com',
    name: 'User',
    presence: 'offline',
    subscription: 'both',
    ...overrides,
  } as Contact
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

describe('getTranslatedStatusText', () => {
  describe('online contacts', () => {
    it('returns presence label for online contact', () => {
      const contact = makeContact({ presence: 'online' })
      expect(getTranslatedStatusText(contact, t)).toBe('presence.online')
    })

    it('returns idle duration for online contact with old lastInteraction', () => {
      const contact = makeContact({
        presence: 'online',
        lastInteraction: new Date(Date.now() - 10 * MINUTE),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.online')
      expect(result).toContain('presence.idle')
    })
  })

  describe('offline contacts without lastSeen', () => {
    it('returns offline label', () => {
      const contact = makeContact({ presence: 'offline' })
      expect(getTranslatedStatusText(contact, t)).toBe('presence.offline')
    })
  })

  describe('offline contacts with lastSeen — duration formatting', () => {
    it('formats just now (< 1 minute)', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 30 * 1000),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.justNow')
    })

    it('formats minutes ago', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 15 * MINUTE),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.minutesAgo:15')
    })

    it('formats hours ago', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 3 * HOUR),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.hoursAgo:3')
    })

    it('formats yesterday', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 1.5 * DAY),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.yesterday')
    })

    it('formats days ago (3 days)', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 3 * DAY),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.daysAgo:3')
    })

    it('formats weeks ago (3 weeks)', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 3 * WEEK),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.weeksAgo:3')
    })

    it('formats months ago (3 months)', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 3 * MONTH),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.monthsAgo:3')
    })

    it('formats years ago (2 years)', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 2 * YEAR),
      })
      const result = getTranslatedStatusText(contact, t)
      expect(result).toContain('presence.yearsAgo:2')
    })

    it('uses months instead of weeks for 5+ weeks', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 5 * WEEK),
      })
      const result = getTranslatedStatusText(contact, t)
      // 35 days / 30 = 1 month
      expect(result).toContain('presence.monthsAgo:1')
    })

    it('uses years instead of months for 12+ months', () => {
      const contact = makeContact({
        presence: 'offline',
        lastSeen: new Date(Date.now() - 13 * MONTH),
      })
      const result = getTranslatedStatusText(contact, t)
      // 390 days / 365 = 1 year
      expect(result).toContain('presence.yearsAgo:1')
    })
  })
})

describe('getTranslatedStatusText — custom status message (issue #4)', () => {
  const MINUTE_MS = 60 * 1000

  it('replaces the show label with the status message when online and active', () => {
    const contact = makeContact({ presence: 'online', statusMessage: 'In a meeting' })
    expect(getTranslatedStatusText(contact, t)).toBe('In a meeting')
  })

  it('replaces the show label for dnd too — "Do not disturb" adds nothing', () => {
    const contact = makeContact({ presence: 'dnd', statusMessage: 'Heads down until 3' })
    expect(getTranslatedStatusText(contact, t)).toBe('Heads down until 3')
  })

  it('keeps the idle suffix alongside the message', () => {
    const contact = makeContact({
      presence: 'online',
      statusMessage: 'In a meeting',
      lastInteraction: new Date(Date.now() - 5 * MINUTE_MS),
    })
    expect(getTranslatedStatusText(contact, t)).toBe('In a meeting · presence.idle 5m')
  })

  it('shows the message alongside last-seen when the contact is offline', () => {
    const contact = makeContact({
      presence: 'offline',
      statusMessage: 'on holiday',
      lastSeen: new Date(Date.now() - 2 * 60 * MINUTE_MS),
    })
    expect(getTranslatedStatusText(contact, t)).toBe('on holiday · presence.lastSeen:presence.hoursAgo:2')
  })

  it('falls back to the show label when there is no status message', () => {
    expect(getTranslatedStatusText(makeContact({ presence: 'online' }), t)).toBe('presence.online')
  })

  it('ignores a blank or whitespace-only status message', () => {
    for (const statusMessage of ['', '   ', '\n\t']) {
      const contact = makeContact({ presence: 'online', statusMessage })
      expect(getTranslatedStatusText(contact, t)).toBe('presence.online')
    }
  })

  it('collapses newlines so a multi-line status cannot break the one-line header', () => {
    const contact = makeContact({ presence: 'online', statusMessage: 'away\nback at 4' })
    expect(getTranslatedStatusText(contact, t)).toBe('away back at 4')
  })

  it('shows the show label when the preference is off, even with a message set', () => {
    const contact = makeContact({ presence: 'online', statusMessage: 'In a meeting' })
    expect(getTranslatedStatusText(contact, t, false)).toBe('presence.online')
  })

  it('with the preference off, an offline contact reads exactly as before', () => {
    const contact = makeContact({
      presence: 'offline',
      statusMessage: 'on holiday',
      lastSeen: new Date(Date.now() - 2 * 60 * MINUTE_MS),
    })
    expect(getTranslatedStatusText(contact, t, false)).toBe('presence.lastSeen:presence.hoursAgo:2')
  })
})

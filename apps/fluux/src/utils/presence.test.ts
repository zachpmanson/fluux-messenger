import { describe, expect, it } from 'vitest'
import type { PresenceShow, PresenceStatus, ResourcePresence } from '@fluux/sdk'
import { getContactPresenceShow, getPresenceColor, getShowColor, resolvePresenceDisplay } from './presence'

const contact = (resources?: ResourcePresence[], presence: PresenceStatus = 'away') => ({
  presence,
  resources: resources && new Map(resources.map((value, index) => [String(index), value])),
})

describe('presence indicator classes', () => {
  it.each(['away', 'xa'] as const)('distinguishes %s while retaining the inactive shape cue', show => {
    expect(getShowColor(show)).toBe(`bg-fluux-presence-${show} presence-away`)
  })

  it('gives DND the shared hollow ring cue', () => {
    expect(getShowColor('dnd')).toBe('presence-dnd')
  })

  it.each(['away', 'xa', 'dnd'] as const)('removes the %s cue while the app is offline', show => {
    expect(getShowColor(show, true)).toBe('bg-slate-500')
    expect(getPresenceColor('away', show, true)).toBe('bg-slate-500')
  })

  it.each([null, undefined, 'chat'] as const)('keeps %s online green', show => {
    expect(getShowColor(show)).toBe('bg-fluux-green')
  })

  it('falls back to the simplified status for unvalidated network show strings', () => {
    const unknownShow = 'invalid-network-show' as PresenceShow
    expect(resolvePresenceDisplay('online', unknownShow)).toBe('online')
    expect(resolvePresenceDisplay('away', unknownShow)).toBe('away')
    expect(resolvePresenceDisplay('dnd', unknownShow)).toBe('dnd')
    expect(resolvePresenceDisplay('offline', unknownShow)).toBe('offline')
    expect(getPresenceColor('online', unknownShow)).toBe('bg-fluux-green')
    expect(getPresenceColor('away', unknownShow)).toBe('bg-fluux-presence-away presence-away')
    expect(getShowColor(unknownShow)).toBe('bg-fluux-muted')
    expect(getShowColor(unknownShow, true)).toBe('bg-slate-500')
  })

  it('keeps explicit offline above stale raw show, and missing metadata at its simplified fallback', () => {
    expect(resolvePresenceDisplay('offline', 'xa')).toBe('offline')
    expect(getPresenceColor('offline', 'xa')).toBe('bg-fluux-gray')
    expect(resolvePresenceDisplay('away', undefined)).toBe('away')
    expect(resolvePresenceDisplay('away', null)).toBe('online')
    expect(resolvePresenceDisplay('away', 'xa')).toBe('xa')
    expect(resolvePresenceDisplay()).toBeUndefined()
  })
})

describe('raw contact presence winner', () => {
  it('uses priority before availability, including negative priorities', () => {
    expect(getContactPresenceShow(contact([
      { priority: 0, show: 'away' }, { priority: 1, show: 'xa' },
    ]))).toBe('xa')
    expect(getContactPresenceShow(contact([
      { priority: -5, show: null }, { priority: -1, show: 'xa' },
    ]))).toBe('xa')
  })

  it('uses SDK availability rank on priority ties, regardless of iteration order', () => {
    for (const resources of [
      [{ priority: 0, show: 'xa' }, { priority: 0, show: 'away' }],
      [{ priority: 0, show: 'away' }, { priority: 0, show: 'xa' }],
    ] as ResourcePresence[][]) {
      expect(getContactPresenceShow(contact(resources))).toBe('away')
    }
    expect(getContactPresenceShow(contact([
      { priority: 0, show: null }, { priority: 0, show: 'chat' },
    ]))).toBe('chat')
  })

  it('retains a stable equivalent-show tie and recognizes plain online metadata', () => {
    expect(getContactPresenceShow(contact([
      { priority: 3, show: 'xa' }, { priority: 3, show: 'xa' },
    ]))).toBe('xa')
    expect(getContactPresenceShow(contact([{ priority: 0, show: null }]))).toBeNull()
    expect(getContactPresenceShow(contact([{ priority: 0, show: undefined } as unknown as ResourcePresence]))).toBeNull()
  })

  it('does not fabricate raw online presence for missing metadata or offline contacts', () => {
    expect(getContactPresenceShow()).toBeUndefined()
    expect(getContactPresenceShow(contact())).toBeUndefined()
    expect(getContactPresenceShow(contact([]))).toBeUndefined()
    expect(getContactPresenceShow(contact([{ priority: 0, show: 'xa' }], 'offline'))).toBeUndefined()
  })
})

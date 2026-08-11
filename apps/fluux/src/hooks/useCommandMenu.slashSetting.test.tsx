import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCommandMenu } from './useCommandMenu'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * The `slashCommandsEnabled` setting (issue #1). With it off, "/" is just a
 * character: the menu never opens, and the composer sends the body as typed —
 * the send path's half of that lives in MessageComposer's `commandsActive` gate.
 */
describe('useCommandMenu — slashCommandsEnabled setting', () => {
  afterEach(() => {
    useSettingsStore.getState().setSlashCommandsEnabled(true)
  })

  it('opens on a partial command by default', () => {
    const { result } = renderHook(() => useCommandMenu('/he', 3, 'room'))
    expect(result.current.state.isActive).toBe(true)
    expect(result.current.state.matches.length).toBeGreaterThan(0)
  })

  it('never opens once slash commands are switched off', () => {
    useSettingsStore.getState().setSlashCommandsEnabled(false)
    const { result } = renderHook(() => useCommandMenu('/he', 3, 'room'))
    expect(result.current.state.isActive).toBe(false)
  })

  it('still reports matches when off, so nothing else silently changes shape', () => {
    // `matches` stays populated — only `isActive` is gated, which keeps the
    // hook's contract identical for any future consumer.
    useSettingsStore.getState().setSlashCommandsEnabled(false)
    const { result } = renderHook(() => useCommandMenu('/he', 3, 'room'))
    expect(result.current.state.matches.length).toBeGreaterThan(0)
  })

  it('reopens when the setting is turned back on', () => {
    useSettingsStore.getState().setSlashCommandsEnabled(false)
    const { result, rerender } = renderHook(() => useCommandMenu('/he', 3, 'room'))
    expect(result.current.state.isActive).toBe(false)

    useSettingsStore.getState().setSlashCommandsEnabled(true)
    rerender()
    expect(result.current.state.isActive).toBe(true)
  })

  it('persists the preference', () => {
    useSettingsStore.getState().setSlashCommandsEnabled(false)
    expect(localStorage.getItem('fluux-slash-commands')).toBe('false')
    useSettingsStore.getState().setSlashCommandsEnabled(true)
    expect(localStorage.getItem('fluux-slash-commands')).toBe('true')
  })
})

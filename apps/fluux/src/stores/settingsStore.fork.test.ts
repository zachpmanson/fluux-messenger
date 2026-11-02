import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from './settingsStore'

const initialState = useSettingsStore.getState()

// The carried branches all extend this store. A restack must retain every
// fork preference without replacing upstream reading, banner or archive state.
describe('fork settings after restacking', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialState)
    vi.mocked(localStorage.setItem).mockReset()
    vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null)
  })
  afterEach(() => {
    useSettingsStore.setState(initialState)
    vi.mocked(localStorage.setItem).mockReset()
    vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null)
  })

  it.each([
    ['markdownEnabled', 'setMarkdownEnabled', 'fluux-markdown'],
    ['slashCommandsEnabled', 'setSlashCommandsEnabled', 'fluux-slash-commands'],
    ['showStatusMessage', 'setShowStatusMessage', 'fluux-status-message'],
    ['sendReadReceipts', 'setSendReadReceipts', 'fluux-send-read-receipts'],
    ['collapseLongMessages', 'setCollapseLongMessages', 'fluux-collapse-long'],
    ['showInChatReactionNotifications', 'setShowInChatReactionNotifications', 'fluux-in-chat-reaction-notifications'],
  ] as const)('persists %s independently of upstream settings', (field, setter, storageKey) => {
    const upstream = {
      readingWidth: initialState.readingWidth,
      readingWidthEnabled: initialState.readingWidthEnabled,
      inAppBannerEnabled: initialState.inAppBannerEnabled,
      archiveOverrides: initialState.archiveOverrides,
    }
    for (const value of [false, true]) {
      useSettingsStore.getState()[setter](value)
      expect(useSettingsStore.getState()[field]).toBe(value)
      expect(localStorage.setItem).toHaveBeenLastCalledWith(storageKey, String(value))
      expect(useSettingsStore.getState()).toMatchObject(upstream)
    }
  })

  it('reloads existing persisted fork keys and roundtrips changes through storage', async () => {
    const saved = new Map([
      ['fluux-markdown', 'false'],
      ['fluux-slash-commands', 'false'],
      ['fluux-status-message', 'false'],
      ['fluux-send-read-receipts', 'false'],
      ['fluux-collapse-long', 'false'],
      ['fluux-in-chat-reaction-notifications', 'false'],
      ['fluux-avatar-shape', 'square'],
      ['fluux-reading-width', '800'],
      ['fluux-reading-width-enabled', 'true'],
      ['fluux-in-app-banner', 'false'],
    ])
    vi.mocked(localStorage.getItem).mockImplementation((key) => saved.get(key) ?? null)
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => { saved.set(key, value) })
    vi.resetModules()
    const first = (await import('./settingsStore')).useSettingsStore
    expect(first.getState()).toMatchObject({
      markdownEnabled: false, slashCommandsEnabled: false, showStatusMessage: false,
      sendReadReceipts: false, collapseLongMessages: false, showInChatReactionNotifications: false,
      avatarShape: 'square', readingWidth: 800, readingWidthEnabled: true,
    })
    first.getState().setMarkdownEnabled(true)
    first.getState().setSlashCommandsEnabled(true)
    first.getState().setShowStatusMessage(true)
    first.getState().setSendReadReceipts(true)
    first.getState().setCollapseLongMessages(true)
    first.getState().setShowInChatReactionNotifications(true)
    first.getState().setAvatarShape('circle')
    vi.resetModules()
    const second = (await import('./settingsStore')).useSettingsStore
    expect(second.getState()).toMatchObject({
      markdownEnabled: true, slashCommandsEnabled: true, showStatusMessage: true,
      sendReadReceipts: true, collapseLongMessages: true, showInChatReactionNotifications: true,
      avatarShape: 'circle', readingWidth: 800, readingWidthEnabled: true,
    })
  })

  it('retains the avatar shape preference alongside the other fork settings', () => {
    useSettingsStore.getState().setAvatarShape('square')
    expect(useSettingsStore.getState().avatarShape).toBe('square')
    expect(localStorage.setItem).toHaveBeenLastCalledWith('fluux-avatar-shape', 'square')
    expect(useSettingsStore.getState().markdownEnabled).toBe(initialState.markdownEnabled)
    expect(useSettingsStore.getState().readingWidth).toBe(initialState.readingWidth)
  })
})

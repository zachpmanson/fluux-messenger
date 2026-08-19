/**
 * Regression for #11 follow-up: the Rooms list rendered room avatar IMAGES
 * through a raw <img> with a hardcoded `rounded-xl`, so they stayed squircles
 * even when the profile-picture shape setting was Square. RoomItem must apply
 * the same shape contract the Avatar component gives MUC icons — rounded
 * square in the default (circle) mode, true square when Square is on.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Room } from '@fluux/sdk'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

vi.mock('@fluux/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fluux/sdk')>()
  return {
    ...actual,
    isMessageFromIgnoredUser: () => false,
    roomActivityTone: () => 'neutral',
    generateConsistentColorHexSync: () => '#123456',
  }
})

const h = vi.hoisted(() => ({
  room: null as Room | null,
  avatarShape: 'circle' as 'circle' | 'square',
}))

vi.mock('@fluux/sdk/react', () => ({
  useRoomStore: (selector: (s: {
    getRoom: (jid: string) => Room | null
    drafts: Map<string, string>
  }) => unknown) => selector({ getRoom: () => h.room, drafts: new Map() }),
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
  useIgnoreStore: (selector: (s: { ignoredUsers: Record<string, unknown[]> }) => unknown) =>
    selector({ ignoredUsers: {} }),
}))

vi.mock('@/hooks', () => ({
  useContextMenu: () => ({
    isOpen: false,
    longPressTriggered: { current: false },
    handleContextMenu: () => {},
    handleTouchStart: () => {},
    handleTouchEnd: () => {},
    position: { x: 0, y: 0 },
    menuRef: { current: null },
    close: () => {},
  }),
  useListKeyboardNav: () => ({}),
  useRouteSync: () => ({}),
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { timeFormat: string; densityMode: string; avatarShape: string }) => unknown) =>
    selector({ timeFormat: '24h', densityMode: 'comfortable', avatarShape: h.avatarShape }),
}))

import { RoomItem } from './RoomsList'

const makeRoom = (over: Partial<Room> = {}): Room =>
  ({
    jid: 'team@conference.fluux.chat',
    name: 'Team',
    joined: true,
    isJoining: false,
    nickname: 'me',
    nickToJidCache: new Map(),
    occupants: new Map([['alice', {}], ['bob', {}]]),
    unreadCount: 0,
    mentionsCount: 0,
    typingUsers: new Set<string>(),
    lastMessage: null,
    avatar: 'data:image/png;base64,AAAA', // a real-looking room photo
    subject: undefined,
    autojoin: false,
    isBookmarked: false,
    ...over,
  }) as unknown as Room

const noop = () => {}
const renderRoom = (room: Room) => {
  h.room = room
  const out = render(
    <RoomItem
      roomJid={room.jid}
      isActive={false}
      isSelected={false}
      isKeyboardNav={false}
      onSelect={noop}
      onActivate={noop}
      onJoin={noop}
      onLeave={noop}
      onEditBookmark={noop}
      onRemoveBookmark={noop}
      onToggleAutojoin={noop}
    />,
  )
  return out.container
}

describe('RoomItem avatar shape', () => {
  it('renders the room photo as a true square when the square setting is on', () => {
    h.avatarShape = 'square'
    const container = renderRoom(makeRoom())
    const img = container.querySelector('img')
    expect(img?.getAttribute('class')).toContain('rounded-none')
    expect(img?.getAttribute('class')).not.toContain('rounded-[28%]')
  })

  it('keeps the room photo a rounded square when the setting is circle', () => {
    h.avatarShape = 'circle'
    const container = renderRoom(makeRoom())
    const img = container.querySelector('img')
    expect(img?.getAttribute('class')).toContain('rounded-[28%]')
    expect(img?.getAttribute('class')).not.toContain('rounded-[28px]')
  })
})
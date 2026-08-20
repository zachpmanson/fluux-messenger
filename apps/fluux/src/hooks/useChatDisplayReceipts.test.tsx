import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useChatDisplayReceipts } from './useChatDisplayReceipts'

// --- SDK surface -----------------------------------------------------------
const windowVisible = { value: true } as { value: boolean }
const settings = { sendReadReceipts: true } as { sendReadReceipts: boolean }

const chatState = {
  activeConversationId: null as string | null,
  messages: new Map<string, Array<{ id: string; isOutgoing?: boolean; body?: string }>>(),
}
const getRoomMock = vi.fn<(jid: string) => { jid: string } | undefined>(() => undefined)
const roomState = {
  getRoom: getRoomMock,
}
const sendChatMarker = vi.fn()
const clientStub = { messages: { sendChatMarker } }

vi.mock('@fluux/sdk/react', () => ({
  useChatStore: (sel: (s: unknown) => unknown) => sel(chatState),
  useConnectionStore: (sel: (s: unknown) => unknown) => sel({ windowVisible: windowVisible.value }),
}))

vi.mock('@fluux/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fluux/sdk')>()),
  useXMPP: () => ({ client: clientStub }),
  chatStore: { getState: () => chatState },
  roomStore: { getState: () => roomState },
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) => sel(settings),
}))

beforeEach(() => {
  windowVisible.value = true
  settings.sendReadReceipts = true
  chatState.activeConversationId = null
  chatState.messages.clear()
  sendChatMarker.mockClear()
  roomState.getRoom.mockReturnValue(undefined)
})

describe('useChatDisplayReceipts', () => {
  it('sends a displayed marker for the newest inbound message in the active 1:1 view', () => {
    chatState.activeConversationId = 'bob@example.com'
    chatState.messages.set('bob@example.com', [
      { id: 'in-0', isOutgoing: false, body: 'earlier' },
      { id: 'in-1', isOutgoing: false, body: 'newest' },
    ])

    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).toHaveBeenCalledWith('bob@example.com', 'in-1', 'displayed')
  })

  it('never sends a displayed marker for our own outgoing messages', () => {
    chatState.activeConversationId = 'alice@example.com'
    chatState.messages.set('alice@example.com', [{ id: 'out-1', isOutgoing: true, body: 'hi' }])

    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).not.toHaveBeenCalled()
  })

  it('sends nothing while the window is hidden', () => {
    chatState.activeConversationId = 'carol@example.com'
    chatState.messages.set('carol@example.com', [{ id: 'in-1', isOutgoing: false, body: 'hi' }])
    windowVisible.value = false

    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).not.toHaveBeenCalled()
  })

  it('sends nothing when read receipts are turned off', () => {
    chatState.activeConversationId = 'dave@example.com'
    chatState.messages.set('dave@example.com', [{ id: 'in-1', isOutgoing: false, body: 'hi' }])
    settings.sendReadReceipts = false

    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).not.toHaveBeenCalled()
  })

  it('sends nothing in a room', () => {
    chatState.activeConversationId = 'room@conference.example.com'
    chatState.messages.set('room@conference.example.com', [{ id: 'in-1', isOutgoing: false, body: 'hi' }])
    roomState.getRoom.mockReturnValue({ jid: 'room@conference.example.com' })

    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).not.toHaveBeenCalled()
  })

  it('does not re-send a marker for the same newest message twice', () => {
    chatState.activeConversationId = 'erin@example.com'
    chatState.messages.set('erin@example.com', [{ id: 'in-1', isOutgoing: false, body: 'hi' }])

    // Two sweeps over the same in-view set → second is a no-op.
    renderHook(() => useChatDisplayReceipts())
    renderHook(() => useChatDisplayReceipts())

    expect(sendChatMarker).toHaveBeenCalledTimes(1)
  })
})
import { useEffect } from 'react'
import { useChatStore, useConnectionStore } from '@fluux/sdk/react'
import { chatStore, roomStore, useXMPP } from '@fluux/sdk'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * XEP-0333 chat-marker emission for the LIVE edge only.
 *
 * Sends a `<displayed/>` marker back to the peer for the newest incoming 1:1
 * message — once the user actually has it on screen with the window focused.
 * Gated on the read-receipts privacy setting (default on) and on
 * `connectionStore` `windowVisible`, so nothing is marked while the window is
 * hidden (the exact gate `useWindowVisibility` drives).
 *
 * 1:1 only: markers are not sent into MUC rooms, where one display would mean
 * a stanza per participant.
 *
 * One marker per (conversation, newest-inbound-id): the sweep marks only the
 * live edge. When a newer peer message arrives (or the window regains focus
 * after being hidden), that message gets marked — but re-opening an old
 * conversation never floods the peer with a marker for every historical
 * message, because the pre-existing newest was already acknowledged.
 */
const lastSentMarker = new Map<string, string>()

export function useChatDisplayReceipts(): void {
  const { client } = useXMPP()
  const sendReadReceipts = useSettingsStore((s) => s.sendReadReceipts)
  const windowVisible = useConnectionStore((s) => s.windowVisible)
  const activeConversationId = useChatStore((s) => s.activeConversationId)

  // Re-run the sweep whenever the in-view message set changes (new arrival,
  // cached load, or refocus), not on every other store write. The length +
  // last-id derivative is cheap and only nudges the effect on an actual change.
  const convSignature = useChatStore((s) => {
    if (!activeConversationId || !s.messages) return ''
    const messages = s.messages.get(activeConversationId)
    if (!messages || messages.length === 0) return ''
    const last = messages[messages.length - 1]
    return `${messages.length}:${last.id}:${last.isOutgoing ? 'out' : 'in'}`
  })

  useEffect(() => {
    if (!activeConversationId || convSignature === '') return
    if (!sendReadReceipts || !windowVisible) return

    // 1:1 only. A joined room (or any MUC JID) means groupchat — no markers.
    if (roomStore.getState().getRoom?.(activeConversationId)) return

    const messages = chatStore.getState().messages?.get(activeConversationId)
    if (!messages || messages.length === 0) return

    // The newest inbound message is the live-edge the user is looking at.
    let newestInbound: { id: string } | undefined
    for (const m of messages) {
      if (!m.isOutgoing) newestInbound = m
    }
    if (!newestInbound) return
    if (lastSentMarker.get(activeConversationId) === newestInbound.id) return
    lastSentMarker.set(activeConversationId, newestInbound.id)

    try {
      // Guard: a host/hook that lacks the low-level send method (e.g. test
      // doubles or a future narrow client) must not take the sweep down.
      ;(client?.messages as any)?.sendChatMarker?.(activeConversationId, newestInbound.id, 'displayed')
    } catch {
      // best-effort — a marker that fails to send is not worth an error
    }
  }, [activeConversationId, convSignature, sendReadReceipts, windowVisible])
}
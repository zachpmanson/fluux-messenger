import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OwnProfileHero } from './OwnProfileHero'

const props = {
  jid: 'me@example.test/current', bareJid: 'me@example.test', localPart: 'me',
  ownNickname: null, ownAvatar: null, presenceShow: 'away' as const,
  statusMessage: null, isConnected: true,
  onOpenAvatarModal: vi.fn(), onClearAvatar: vi.fn(async () => {}),
  onSetNickname: vi.fn(async () => {}), onClearNickname: vi.fn(async () => {}),
}

describe('OwnProfileHero raw presence', () => {
  it('keeps the avatar and status dot orange for automatic XA, then yellow for away', () => {
    const { container, rerender } = render(<OwnProfileHero {...props} actualShow="xa" />)
    expect(container.querySelectorAll('.bg-fluux-presence-xa')).toHaveLength(2)
    expect(container.querySelector('.bg-fluux-presence-away')).toBeNull()
    rerender(<OwnProfileHero {...props} actualShow="away" />)
    expect(container.querySelectorAll('.bg-fluux-presence-away')).toHaveLength(2)
    expect(container.querySelector('.bg-fluux-presence-xa')).toBeNull()
  })

  it('connection-offline styling wins for both surfaces despite stale XA', () => {
    const { container } = render(<OwnProfileHero {...props} actualShow="xa" isConnected={false} />)
    expect(container.querySelectorAll('.bg-slate-500')).toHaveLength(2)
    expect(container.querySelector('.bg-fluux-presence-xa')).toBeNull()
  })
})

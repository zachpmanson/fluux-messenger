import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { AvatarLightbox } from './AvatarLightbox'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('./Avatar', () => ({ Avatar: () => null }))

describe('AvatarLightbox Escape handling', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<AvatarLightbox identifier="user@x" onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('consumes Escape so it never reaches the window-level shortcut handler', () => {
    // Same regression guard as ImageLightbox: closing the avatar view with Escape
    // must not also fire the window-level conversation shortcut (scroll-to-bottom).
    const onClose = vi.fn()
    const windowKeydown = vi.fn()
    window.addEventListener('keydown', windowKeydown)
    try {
      render(<AvatarLightbox identifier="user@x" onClose={onClose} />)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(windowKeydown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', windowKeydown)
    }
  })
})

describe('AvatarLightbox — avatar shape setting (issue #6)', () => {
  afterEach(() => {
    useSettingsStore.getState().setAvatarShape('circle')
  })

  it('shows a round enlarged image by default', () => {
    render(<AvatarLightbox avatarUrl="https://example.com/a.jpg" identifier="a@b.c" name="A" onClose={() => {}} />)
    const img = screen.getByAltText('A')
    expect(img.className).toContain('rounded-full')
  })

  it('squares the enlarged image when the setting is square — enlarging must not change the shape', () => {
    useSettingsStore.getState().setAvatarShape('square')
    render(<AvatarLightbox avatarUrl="https://example.com/a.jpg" identifier="a@b.c" name="A" onClose={() => {}} />)
    const img = screen.getByAltText('A')
    expect(img.className).toContain('rounded-none')
    expect(img.className).not.toContain('rounded-full')
  })
})

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AppIconMark } from './AppIconMark'

describe('AppIconMark', () => {
  it('renders a decorative icon with the circular message mark', () => {
    const { container } = render(<AppIconMark size={72} />)
    const svg = container.querySelector('svg.app-icon-mark')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('viewBox')).toBe('0 0 1024 1024')
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(svg!.getAttribute('width')).toBe('72')
    expect(container.querySelector('circle[cx="512"][cy="510"][r="218"]')).not.toBeNull()
    expect(container.querySelector('path[d="M386 640 L332 808 L512 690 Z"]')).not.toBeNull()
  })

  it('keeps both plain icon SVG sources aligned with the circular mark', () => {
    for (const source of ['icon-source.svg', 'icon-source-maskable.svg']) {
      const svg = readFileSync(
        resolve(process.cwd(), 'src-tauri/icons/icon-variants/plain', source),
        'utf8',
      )
      expect(svg).toContain('<circle cx="512" cy="510" r="218"/>')
      expect(svg).toContain('<path d="M386 640 L332 808 L512 690 Z"/>')
    }
  })
})

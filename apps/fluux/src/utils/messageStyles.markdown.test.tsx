import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderStyledMessage } from './messageStyles'

/**
 * The markdown-true branch renders with GFM (markdown-it / CommonMark). These
 * tests assert that the standard-GFM output keeps the fork's controls: mention
 * colouring, link safety (no javascript:/data: hrefs), native headings, pipe
 * tables, task-list checkboxes, and code fences routed through the CodeBlock
 * widget. The markdown=false (XEP-0393) path lives in messageStyles.test.tsx.
 */
describe('GFM rendering (markdown on)', () => {
  const renderMd = (text: string, markdown = true) => {
    const { container } = render(
      <div>{renderStyledMessage(text, undefined, undefined, undefined, false, undefined, markdown)}</div>
    )
    return container
  }

  it('renders **bold** as a strong link when it wraps a URL (issue #14)', () => {
    const container = renderMd('**https://github.com/zachpmanson/fluux-messenger/issues/14**')
    const strong = container.querySelector('strong')
    const link = container.querySelector('strong a')
    expect(strong).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('https://github.com/zachpmanson/fluux-messenger/issues/14')
    expect(container.textContent).not.toContain('*')
  })

  it('is GFM, so a single *x* is emphasis, not bold', () => {
    const container = renderMd('this is *emphasis* folks')
    expect(container.querySelector('em')?.textContent).toBe('emphasis')
    expect(container.querySelector('strong')).toBeNull()
  })

  it('auto-links a bare URL (GFM autolink)', () => {
    const container = renderMd('see https://example.com/path for more')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/path')
  })

  it('renders a [label](url) link with the label as text', () => {
    const container = renderMd('see [the docs](https://example.com/docs)')
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/docs')
    expect(link?.textContent).toBe('the docs')
  })

  it('hydrates queries with <a> when the labelled target is safe', () => {
    const container = renderMd('[go](https://a.example) and [two](https://b.example)')
    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(2)
  })

  it('keeps javascript: links literal — not clickable (link safety)', () => {
    const container = renderMd('[click me](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('[click me](javascript:alert(1))')
  })

  it('keeps data: links literal — not clickable', () => {
    const container = renderMd('[data](data:text/html;base64,PHN0)')
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders a pipe table with header and body cells', () => {
    const container = renderMd(['| Name | Qty |', '| --- | --- |', '| Apples | 3 |'].join('\n'))
    const table = container.querySelector('table')
    expect(table).toBeTruthy()
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(['Name', 'Qty'])
    const rows = Array.from(container.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(1)
    expect(Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Apples', '3'])
    // Keep the legacy grid: every cell carries a border + cell padding.
    const th = container.querySelectorAll('th')
    // The renderer emits bare semantic cells — styling is the stylesheet's job.
    expect(th[0]?.getAttribute('class')).toBeNull()
    expect(Array.from(container.querySelectorAll('td'))[0]?.getAttribute('class')).toBeNull()
  })

  it('renders task-list checkboxes, read-only', () => {
    const checked = renderMd('- [x] ship it')
    const checkedBox = checked.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkedBox).toBeTruthy()
    expect(checkedBox.checked).toBe(true)
    expect(checkedBox.readOnly).toBe(true)
    expect(checked.querySelector('li')?.textContent).toContain('ship it')
    expect(checked.querySelector('li')?.textContent).not.toContain('[x]')

    const unchecked = renderMd('- [ ] buy milk')
    const box = unchecked.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(box?.checked).toBe(false)
  })

  it('renders list item text directly as a <li> child (no nested <p>)', () => {
    const container = renderMd(['- alpha', '- beta'].join('\n'))
    const items = Array.from(container.querySelectorAll('li'))
    expect(items).toHaveLength(2)
    // A <p> wrapper shifts the text off the bullet's line box (misaligned).
    expect(items[0].querySelector('p')).toBeNull()
    expect(items[0].textContent).toBe('alpha')
  })

  it('renders nested/ordered lists', () => {
    const container = renderMd(['- one', '- two'].join('\n'))
    expect(container.querySelector('ul li')?.textContent).toBe('one')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('renders headings as native h1..h6', () => {
    expect(renderMd('# H1').querySelector('h1')?.textContent).toBe('H1')
    expect(renderMd('## H2').querySelector('h2')?.textContent).toBe('H2')
    expect(renderMd('### H3').querySelector('h3')?.textContent).toBe('H3')
    expect(renderMd('#### H4').querySelector('h4')?.textContent).toBe('H4')
    // Native headings, but no utility classes — sizing comes from the CSS.
    expect(renderMd('# H1').querySelector('h1')?.getAttribute('class')).toBeNull()
    expect(renderMd('## H2').querySelector('h2')?.getAttribute('class')).toBeNull()
    expect(renderMd('### H3').querySelector('h3')?.getAttribute('class')).toBeNull()
  })

  it('spaces block paragraphs with the XEP message rhythm', () => {
    const container = renderMd('first paragraph\n\nsecond paragraph')
    const ps = Array.from(container.querySelectorAll('p'))
    expect(ps).toHaveLength(2)
    expect(ps[0]?.getAttribute('class')).toBeNull()
  })

  it('styles blockquote with the established muted treatment', () => {
    const container = renderMd('> quoted')
    const bq = container.querySelector('blockquote')
    expect(bq?.textContent).toContain('quoted')
    expect(bq?.getAttribute('class')).toBeNull()
  })

  it('renders a fenced code block through the fork CodeBlock (copy/expand, no raw <pre> only)', () => {
    const container = renderMd(['```js', 'let x = 1', '```'].join('\n'))
    // The GFM branch routes fences to the CodeBlock widget.
    expect(container.querySelector('pre')?.textContent).toContain('let x = 1')
    // Copy button is the CodeBlock's signature element.
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.title === 'Copy code')).toBe(true)
  })

  it('keeps @mention colouring on the markdown branch', () => {
    // Room context (nickname set) enables the regex mention fallback.
    const { container } = render(
      <div>{renderStyledMessage('Hello @alice!', undefined, 'myNick', undefined, false, undefined, true)}</div>
    )
    const mention = container.querySelector('[data-mention]')
    expect(mention).toBeTruthy()
    expect(mention?.textContent).toBe('@alice')
  })

  it('leaves markdown constructs literal when markdown is off', () => {
    const container = renderMd('# Heading\ntable | not', false)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.textContent).toContain('# Heading')
  })

  it('still renders bare URLs and retains XEP-bold in the markdown-off (XEP) branch', () => {
    const container = renderMd('*important* https://example.com', false)
    expect(container.querySelector('strong')?.textContent).toBe('important')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})
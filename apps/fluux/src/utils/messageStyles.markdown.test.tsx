import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderStyledMessage } from './messageStyles'

/**
 * Covers the Markdown-only constructs gated behind the `markdownEnabled`
 * setting: tables, labelled links, nested lists, and headings. XEP-0393 styling
 * is covered in messageStyles.test.tsx and must keep rendering with the setting
 * off, which the "markdown disabled" block pins.
 */
describe('Markdown rendering', () => {
  const renderMd = (text: string, markdown = true) => {
    const { container } = render(
      <div>{renderStyledMessage(text, undefined, undefined, undefined, false, undefined, markdown)}</div>
    )
    return container
  }

  describe('tables', () => {
    const TABLE = ['| Name | Qty |', '| --- | --- |', '| Apples | 3 |', '| Pears | 12 |'].join('\n')

    it('renders a pipe table with header and body cells', () => {
      const container = renderMd(TABLE)
      const table = container.querySelector('table')
      expect(table).toBeTruthy()

      const headers = container.querySelectorAll('th')
      expect(Array.from(headers).map((th) => th.textContent)).toEqual(['Name', 'Qty'])

      const rows = container.querySelectorAll('tbody tr')
      expect(rows).toHaveLength(2)
      expect(Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Apples', '3'])
      expect(Array.from(rows[1].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Pears', '12'])
    })

    it('accepts rows without leading and trailing pipes', () => {
      const container = renderMd(['Name | Qty', '--- | ---', 'Apples | 3'].join('\n'))
      expect(container.querySelectorAll('th')).toHaveLength(2)
      expect(container.querySelectorAll('tbody td')).toHaveLength(2)
    })

    it('applies column alignment from the delimiter row', () => {
      const container = renderMd(['| L | C | R |', '| :--- | :---: | ---: |', '| a | b | c |'].join('\n'))
      const headers = container.querySelectorAll('th')
      expect(headers[0].className).toContain('text-left')
      expect(headers[1].className).toContain('text-center')
      expect(headers[2].className).toContain('text-right')
    })

    it('styles cell contents inline', () => {
      const container = renderMd(['| Name |', '| --- |', '| *bold* |'].join('\n'))
      expect(container.querySelector('td strong')?.textContent).toBe('bold')
    })

    it('pads short rows so cells stay under the right column', () => {
      const container = renderMd(['| A | B |', '| --- | --- |', '| only |'].join('\n'))
      const cells = container.querySelectorAll('tbody td')
      expect(cells).toHaveLength(2)
      expect(cells[0].textContent).toBe('only')
      expect(cells[1].textContent).toBe('')
    })

    it('treats escaped pipes as cell content, not separators', () => {
      const container = renderMd(['| Expr |', '| --- |', '| a \\| b |'].join('\n'))
      const cells = container.querySelectorAll('tbody td')
      expect(cells).toHaveLength(1)
      expect(cells[0].textContent).toBe('a | b')
    })

    it('ends the table at the first non-table line', () => {
      const container = renderMd([TABLE, 'after the table'].join('\n'))
      expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
      expect(container.textContent).toContain('after the table')
    })

    it('leaves prose containing a pipe alone', () => {
      const container = renderMd('use a | b to pipe')
      expect(container.querySelector('table')).toBeNull()
      expect(container.textContent).toBe('use a | b to pipe')
    })

    it('needs a delimiter row — a lone pipe row is not a table', () => {
      const container = renderMd('| Name | Qty |')
      expect(container.querySelector('table')).toBeNull()
    })
  })

  describe('labelled links', () => {
    it('renders [label](url) with the label as the link text', () => {
      const container = renderMd('see [the docs](https://example.com/docs) for more')
      const link = container.querySelector('a')
      expect(link?.getAttribute('href')).toBe('https://example.com/docs')
      expect(link?.textContent).toBe('the docs')
      expect(container.textContent).toBe('see the docs for more')
    })

    it('renders several labelled links in one line', () => {
      const container = renderMd('[one](https://a.example) and [two](https://b.example)')
      const links = container.querySelectorAll('a')
      expect(Array.from(links).map((a) => a.getAttribute('href'))).toEqual([
        'https://a.example',
        'https://b.example',
      ])
      expect(Array.from(links).map((a) => a.textContent)).toEqual(['one', 'two'])
    })

    it('still auto-links bare URLs alongside labelled ones', () => {
      const container = renderMd('[label](https://a.example) then https://b.example')
      const links = container.querySelectorAll('a')
      expect(links).toHaveLength(2)
      expect(links[1].textContent).toBe('https://b.example')
    })

    it('leaves non-http targets literal so odd schemes cannot become links', () => {
      const container = renderMd('[click](javascript:alert(1))')
      expect(container.querySelector('a')).toBeNull()
      expect(container.textContent).toBe('[click](javascript:alert(1))')
    })

    it('honours a backslash-escaped bracket', () => {
      const container = renderMd('\\[not a link](https://example.com)')
      expect(container.textContent).toContain('[not a link]')
    })

    it('styles text around a labelled link', () => {
      const container = renderMd('*before* [label](https://example.com) `after`')
      expect(container.querySelector('strong')?.textContent).toBe('before')
      expect(container.querySelector('code')?.textContent).toBe('after')
      expect(container.querySelector('a')?.textContent).toBe('label')
    })
  })

  describe('nested lists', () => {
    it('nests an indented unordered item under its parent', () => {
      const container = renderMd(['- top', '  - child', '- second'].join('\n'))
      const outer = container.querySelector('ul')
      expect(outer).toBeTruthy()

      const outerItems = outer!.querySelectorAll(':scope > li')
      expect(outerItems).toHaveLength(2)
      expect(outerItems[0].querySelector('ul')).toBeTruthy()
      expect(outerItems[0].querySelector('ul li')?.textContent).toBe('child')
      expect(outerItems[1].textContent).toBe('second')
    })

    it('nests two levels deep', () => {
      const container = renderMd(['- a', '  - b', '    - c'].join('\n'))
      expect(container.querySelector('ul li ul li ul li')?.textContent).toBe('c')
    })

    it('nests ordered items too, keeping the start number', () => {
      const container = renderMd(['3. three', '  1. sub', '4. four'].join('\n'))
      const outer = container.querySelector('ol')
      expect(outer?.getAttribute('start')).toBe('3')
      expect(outer?.querySelectorAll(':scope > li')).toHaveLength(2)
      expect(container.querySelector('ol li ol li')?.textContent).toBe('sub')
    })

    it('treats a tab as one nesting level', () => {
      const container = renderMd(['- top', '\t- child'].join('\n'))
      expect(container.querySelector('ul li ul li')?.textContent).toBe('child')
    })

    it('keeps a flat list flat', () => {
      const container = renderMd(['- one', '- two', '- three'].join('\n'))
      expect(container.querySelectorAll('ul')).toHaveLength(1)
      expect(container.querySelectorAll('li')).toHaveLength(3)
    })
  })

  describe('markdown disabled', () => {
    it('leaves a table as plain text', () => {
      const container = renderMd(['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'), false)
      expect(container.querySelector('table')).toBeNull()
      expect(container.textContent).toContain('| A | B |')
    })

    it('leaves [label](url) literal', () => {
      const container = renderMd('[label](https://example.com)', false)
      expect(container.textContent).toBe('[label](https://example.com)')
    })

    it('leaves list markers and headings as text', () => {
      const container = renderMd(['# Heading', '- one', '1. two'].join('\n'), false)
      expect(container.querySelector('ul')).toBeNull()
      expect(container.querySelector('ol')).toBeNull()
      expect(container.textContent).toContain('# Heading')
      expect(container.textContent).toContain('- one')
      expect(container.textContent).toContain('1. two')
    })

    it('still renders XEP-0393 styling, which is not Markdown-gated', () => {
      const container = renderMd('*bold* _italic_ ~strike~ `code`', false)
      expect(container.querySelector('strong')?.textContent).toBe('bold')
      expect(container.querySelector('em')?.textContent).toBe('italic')
      expect(container.querySelector('del')?.textContent).toBe('strike')
      expect(container.querySelector('code')?.textContent).toBe('code')
    })

    it('still renders blockquotes and bare URLs', () => {
      const container = renderMd('> quoted https://example.com', false)
      expect(container.querySelector('blockquote')).toBeTruthy()
      expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    })
  })
})

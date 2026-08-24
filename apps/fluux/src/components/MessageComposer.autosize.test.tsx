import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MessageComposer } from './MessageComposer'

// Composer autosize regression guard.
//
// Root cause of the "composer mounts at a full-height cap for a one-line draft"
// bug: the autosize effect only ran on [text]. If the measurement happened while
// the textarea was transiently narrow (window size being restored at app
// startup, sidebar drag, viewport resize), the wrapped content exceeded the
// 50vh cap, height was clamped to half the viewport, and NOTHING re-measured
// until the next keystroke. The fix re-measures whenever the textarea's WIDTH
// or the viewport HEIGHT changes (via ResizeObserver + window resize).
//
// jsdom has no layout, so scrollHeight is mocked and the ResizeObserver is a
// hand-driven fake: tests simulate "the layout width changed" by firing the
// observer callback with a new contentRect width. The 50vh cap follows the
// test-pinned viewport height (VIEWPORT_PX); the tests pick scrollHeights
// relative to that cap.

// Pinned viewport so the 50vh cap is deterministic: cap = VIEWPORT_PX / 2.
const VIEWPORT_PX = 800
const COMPOSER_CAP_PX = VIEWPORT_PX / 2

type ROCallback = (entries: { contentRect: { width: number } }[]) => void

let roCallbacks: ROCallback[] = []
let roObserved: Element[] = []
let roDisconnected = 0

class MockResizeObserver {
  constructor(cb: ROCallback) {
    roCallbacks.push(cb)
  }
  observe(el: Element) {
    roObserved.push(el)
  }
  unobserve() {}
  disconnect() {
    roDisconnected++
  }
}

let mockScrollHeight = 48

const fireResize = (width: number) => {
  act(() => {
    roCallbacks.forEach((cb) => cb([{ contentRect: { width } }]))
  })
}

describe('MessageComposer autosize', () => {
  let originalRO: typeof ResizeObserver | undefined
  let scrollHeightSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    roCallbacks = []
    roObserved = []
    roDisconnected = 0
    mockScrollHeight = 48
    // Pin the viewport so the 50vh cap (COMPOSER_CAP_PX) is deterministic.
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: VIEWPORT_PX,
    })
    originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'TEXTAREA' ? mockScrollHeight : 0
      })
  })

  afterEach(() => {
    scrollHeightSpy.mockRestore()
    if (originalRO) {
      globalThis.ResizeObserver = originalRO
    } else {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    }
  })

  const renderComposer = (value: string) =>
    render(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value={value}
        onValueChange={() => {}}
      />
    )

  it('sizes to content on mount', () => {
    const { container } = renderComposer('Hello world test')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('48px')
  })

  it('observes the textarea for width changes', () => {
    const { container } = renderComposer('Hello world test')
    const textarea = container.querySelector('textarea')
    expect(roObserved).toContain(textarea)
  })

  it('re-measures when the width changes — recovers from a stale narrow-width clamp', () => {
    // Mount while the layout is transiently narrow: content wraps massively,
    // height clamps to the 50vh max (400px at the pinned viewport). This is
    // the reported bug state.
    mockScrollHeight = 600
    const { container } = renderComposer('Hello world test')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('400px')

    // Layout settles at the real width: one line again. No keystroke.
    mockScrollHeight = 48
    fireResize(828)
    expect(textarea.style.height).toBe('48px')
  })

  it('re-measures when the composer gets narrower and content needs more lines', () => {
    const { container } = renderComposer('A long draft that wraps when narrow')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('48px')

    fireResize(828) // baseline width
    mockScrollHeight = 96
    fireResize(211) // narrower: content now needs more lines
    expect(textarea.style.height).toBe('96px')
  })

  it('ignores observer callbacks when the width has not changed (height-only echoes)', () => {
    renderComposer('Hello world test')

    fireResize(828) // baseline
    const readsBefore = scrollHeightSpy.mock.calls.length
    fireResize(828) // our own style.height write echoes through the observer
    expect(scrollHeightSpy.mock.calls.length).toBe(readsBefore)
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = renderComposer('Hello world test')
    unmount()
    expect(roDisconnected).toBeGreaterThan(0)
  })

  it('re-clamps to the new 50vh cap when the viewport height changes', () => {
    mockScrollHeight = 500 // above the 400px cap at the pinned 800px viewport
    const { container } = renderComposer('a\nb\nc\nd\ne\nf\ng\nh\ni')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('400px') // clamps at 50vh
    expect(textarea.style.overflowY).toBe('auto')

    // Viewport shrinks to 600px → 50vh cap falls to 300px. The width observer
    // never fires (the textarea's width is unchanged), but the window resize
    // listener re-measures the height cap.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(textarea.style.height).toBe('300px')
    expect(textarea.style.overflowY).toBe('auto')

    // Growing the viewport back lifts the cap with it.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(textarea.style.height).toBe('400px')
  })

  // --- Scrollbar only past the 50vh cap -------------------------------------
  // With overflow-y:auto always on, Blink (mobile Brave) paints a scrollbar for
  // a single line because the integer height we write can round under the
  // fractional content height. Keep overflow-y hidden until content genuinely
  // exceeds the 50vh cap (400px), where a scrollbar is actually needed.
  it('keeps overflow-y hidden below the max height', () => {
    mockScrollHeight = 48 // one line
    const { container } = renderComposer('Hello world test')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.overflowY).toBe('hidden')
  })

  it('switches overflow-y to auto once content exceeds the 50vh cap', () => {
    mockScrollHeight = 500 // taller than the 400px cap
    const { container } = renderComposer('Nine\nlines\nof\ntext\nthat\noverflow\nthe\ncomposer\ncap')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('400px')
    expect(textarea.style.overflowY).toBe('auto')
  })

  it('restores overflow-y hidden when a tall draft shrinks back under the cap', () => {
    mockScrollHeight = 500
    const { container, rerender } = renderComposer('a\nb\nc\nd\ne\nf\ng\nh\ni')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.overflowY).toBe('auto')

    mockScrollHeight = 48 // deleted back to one line
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value="a"
        onValueChange={() => {}}
      />
    )
    expect(textarea.style.overflowY).toBe('hidden')
  })

  // The reported "half-line" bug. `scrollHeight` is padding-inclusive and the
  // textarea is border-box, so a draft that exactly fills the cap reaches the
  // max height while still fitting. The next line overflows without changing
  // newHeight — and the fast path used to return before writing overflow-y,
  // leaving content clipped inside an overflow:hidden box with no scrollbar.
  it('flips overflow-y to auto when content overflows a box already at the cap', () => {
    mockScrollHeight = 400 // fills the cap exactly — fits, no scrollbar needed
    const { container, rerender } = renderComposer('1\n2\n3\n4\n5\n6\n7')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('400px')
    expect(textarea.style.overflowY).toBe('hidden')

    mockScrollHeight = 424 // one line more: genuinely overflows the 400px box
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value={'1\n2\n3\n4\n5\n6\n7\n8'}
        onValueChange={() => {}}
      />
    )

    expect(textarea.style.overflowY).toBe('auto')
  })

  // The cap has to be expressed in the same coordinate system as the value it
  // is compared against. `scrollHeight` includes the block padding (py-3 = 24px
  // in the app), so a padding-blind cap is short by exactly that padding: the
  // height saturates early and the composer clips a line.
  it('accounts for block padding in the 50vh cap', () => {
    const realGetComputedStyle = globalThis.getComputedStyle
    const gcsSpy = vi
      .spyOn(globalThis, 'getComputedStyle')
      .mockImplementation((el: Element, pseudo?: string | null) => {
        const style = realGetComputedStyle(el, pseudo)
        if ((el as HTMLElement).tagName === 'TEXTAREA') {
          return { ...style, paddingTop: '12px', paddingBottom: '12px' } as CSSStyleDeclaration
        }
        return style
      })

    // Content that fills the 50vh cap (400px) plus 24px of padding: the tallest
    // draft that must be shown in full. A padding-blind cap clamps this to
    // 400px and clips a line.
    mockScrollHeight = COMPOSER_CAP_PX + 24 // 424
    const { container } = renderComposer('1\n2\n3\n4\n5\n6\n7\n8')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    expect(textarea.style.height).toBe('424px')
    expect(textarea.style.overflowY).toBe('hidden') // fits exactly — no scrollbar

    gcsSpy.mockRestore()
  })

  // When overflow first appears there is no prior scroll offset to preserve.
  // Writing the pre-overflow value back (0) undoes the browser's caret-into-view
  // scroll, dropping the caret out of sight — the reported caret inaccuracy.
  it('does not write a stale scroll offset when overflow first appears', () => {
    mockScrollHeight = 400
    const { container, rerender } = renderComposer('1\n2\n3\n4\n5\n6\n7')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    const writes: number[] = []
    let scrollTop = 0
    Object.defineProperty(textarea, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        writes.push(v)
        scrollTop = v
      },
    })

    mockScrollHeight = 424 // crosses into overflow for the first time
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value={'1\n2\n3\n4\n5\n6\n7\n8'}
        onValueChange={() => {}}
      />
    )

    expect(writes).toEqual([])

    // Control: once the textarea IS scrollable, a re-measure must still restore
    // the offset — otherwise the assertion above would pass simply because the
    // restore is dead code rather than because it is correctly gated.
    scrollTop = 48
    mockScrollHeight = 500
    fireResize(300)
    expect(writes).toEqual([48])
  })

  // --- Per-keystroke forced-layout avoidance --------------------------------
  // resizeToContent ran on every keystroke and unconditionally (a) reset the
  // textarea to height:auto and (b) called onInputResize. The auto-reset
  // changes the composer's box, relayouting the flex column — including the
  // entire non-virtualized message list — and onInputResize then reads the
  // list's scrollHeight, forcing a second full layout. In a long conversation
  // every keystroke therefore paid a full message-list reflow (~30ms measured
  // at ~900 messages). The composer must not disturb layout when the typed
  // text does not change the composer's height.
  const renderWithResize = (value: string, onInputResize: () => void) =>
    render(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value={value}
        onValueChange={() => {}}
        onInputResize={onInputResize}
      />
    )

  it('does not fire onInputResize on an append that leaves the height unchanged', () => {
    const onInputResize = vi.fn()
    mockScrollHeight = 48
    const { rerender } = renderWithResize('Hello', onInputResize)
    onInputResize.mockClear() // ignore the mount-time sizing call

    // Append one character on the same line — height is unchanged.
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value="Hello!"
        onValueChange={() => {}}
        onInputResize={onInputResize}
      />
    )

    expect(onInputResize).not.toHaveBeenCalled()
  })

  it('fires onInputResize and grows when an append wraps to a new line', () => {
    const onInputResize = vi.fn()
    mockScrollHeight = 48
    const { container, rerender } = renderWithResize('Hello', onInputResize)
    onInputResize.mockClear()

    mockScrollHeight = 72 // content now needs a second line
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value="Hello world that now wraps onto a second line"
        onValueChange={() => {}}
        onInputResize={onInputResize}
      />
    )

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('72px')
    expect(onInputResize).toHaveBeenCalled()
  })

  it('shrinks (and fires onInputResize) when text is deleted back to one line', () => {
    const onInputResize = vi.fn()
    mockScrollHeight = 72
    const { container, rerender } = renderWithResize('two\nlines', onInputResize)
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.style.height).toBe('72px')
    onInputResize.mockClear()

    mockScrollHeight = 48 // deleted back to one line
    rerender(
      <MessageComposer
        placeholder="Type a message"
        onSend={vi.fn().mockResolvedValue(true)}
        value="two"
        onValueChange={() => {}}
        onInputResize={onInputResize}
      />
    )

    expect(textarea.style.height).toBe('48px')
    expect(onInputResize).toHaveBeenCalled()
  })
})

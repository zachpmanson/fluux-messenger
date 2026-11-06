// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollStateManager } from '@/utils/scrollStateManager'
import { messageRowId } from './messageRowIdentity'
import type { MessageVirtualizer } from './messageVirtualizer'
import { PositioningController } from './positioningController'
import { getScrollShadowSnapshot, resetScrollShadowDiagnostics } from './scrollPositionShadow'
import { useMessageListScroll, type UseMessageListScrollResult } from './useMessageListScroll'
import * as scrollBinding from './useScrollContainerBinding'
import { useTanstackMessageVirtualizer } from './tanstackMessageVirtualizer'
import { MEDIA_LOAD_DEBOUNCE_MS } from './useMediaGrowthPreservation'

let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let observers: Set<GeometryObserver>

class GeometryObserver implements ResizeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { observers.delete(this); this.targets.clear() }
}

function settle() {
  for (let count = 0; frames.size && count < 100; count++) {
    act(() => {
      for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(performance.now())
    })
  }
  expect(frames.size).toBe(0)
  expect(getScrollShadowSnapshot().instrumentationErrors).toEqual([])
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  nextFrame = 0
  observers = new Set()
  scrollStateManager.reset()
  resetScrollShadowDiagnostics()
  vi.stubGlobal('ResizeObserver', GeometryObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fixture() {
  const rows = Array.from({ length: 50 }, (_, index) => {
    const message = { id: index === 2 || index === 3 ? 'reused' : `message-${index}`,
      occupantId: `occupant-${index}`, stanzaId: `archive-${index}` }
    return { ...message, rowId: messageRowId(message)!, height: 100 }
  })
  const items = rows.map(row => ({ key: row.rowId }))
  const indexById = new Map(items.map((item, index) => [item.key, index]))
  const totalHeight = () => rows.reduce((total, row) => total + row.height, 0)
  const rowTop = (index: number) => rows.slice(0, index).reduce((total, row) => total + row.height, 0)
  let top = 0
  let client = 300
  let scroller!: HTMLDivElement
  let virtualizer!: MessageVirtualizer
  let api!: UseMessageListScrollResult
  const writes: number[] = []
  const scrollEvents: number[] = []
  const loadOlder = vi.fn()
  const loadNewer = vi.fn()
  const liveEdgeMeasurements = vi.fn()

  let conversationId = 'room'
  let renderCount = 0
  let suspend!: () => void
  let resolveSuspension!: () => void
  let suspensionResolved = false
  const suspension = new Promise<void>(resolve => { resolveSuspension = resolve })
  function Harness() {
    renderCount++
    const [suspended, setSuspended] = React.useState(false)
    suspend = () => setSuspended(true)
    const scrollRef = React.useRef<HTMLDivElement | null>(null)
    const currentVirtualizer = useTanstackMessageVirtualizer({ items, indexById, scrollRef, estimateSize: 100 })
    const currentApi = useMessageListScroll({
      conversationId, messageCount: rows.length,
      firstMessageId: rows[0].rowId, lastMessageId: rows.at(-1)!.rowId,
      rowGrowthSignature: '', windowAtLiveEdge: true, virtualizer: currentVirtualizer,
      onScrollToTop: loadOlder, onLoadNewer: loadNewer, onLiveEdgeMeasured: liveEdgeMeasurements,
    })
    const setContainer = currentApi.setScrollContainerRef
    const setScroller = React.useCallback((node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (node) {
        scroller = node
        Object.defineProperties(node, {
          offsetWidth: { configurable: true, value: 800 },
          offsetHeight: { configurable: true, get: () => client },
          clientHeight: { configurable: true, get: () => client },
          scrollHeight: { configurable: true, get: totalHeight },
          scrollTop: { configurable: true, get: () => top, set: (value: number) => {
            top = Math.max(0, Math.min(value, totalHeight() - client))
            writes.push(top)
          } },
        })
        node.getBoundingClientRect = () => new DOMRect(0, 0, 800, client)
        node.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
          node.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0
        }
      }
      setContainer(node)
    }, [setContainer])
    React.useLayoutEffect(() => { virtualizer = currentVirtualizer; api = currentApi })
    if (suspended && !suspensionResolved) throw suspension
    return <div ref={setScroller} data-message-list onScroll={event => {
      scrollEvents.push(event.currentTarget.scrollTop)
      currentApi.handleScroll(event)
    }}>
      <div ref={currentApi.contentWrapperRef}>
        {rows.map((row, index) => <div key={row.rowId} data-index={index}
          data-message-id={row.id} data-message-row-id={row.rowId} className="message-row" ref={node => {
            if (!node) return
            Object.defineProperty(node, 'offsetHeight', { configurable: true, get: () => row.height })
            node.getBoundingClientRect = () => new DOMRect(0, rowTop(index) - top, 800, row.height)
            currentVirtualizer.measureElement(node)
          }} />)}
      </div>
    </div>
  }

  const renderHarness = () => <React.Suspense fallback={<div>Suspended</div>}><Harness /></React.Suspense>
  const view = render(renderHarness())
  settle()
  expect(scroller.scrollTop).toBe(4700)
  return {
    rows, writes, scrollEvents, loadOlder, loadNewer, liveEdgeMeasurements, scroller, totalHeight,
    suspend: () => suspend(),
    resolveSuspension: () => act(async () => {
      suspensionResolved = true
      resolveSuspension()
      await suspension
    }),
    switchConversation: (id: string) => act(() => {
      conversationId = id
      view.rerender(renderHarness())
    }),
    get renderCount() { return renderCount },
    get virtualizer() { return virtualizer },
    get api() { return api },
    move: (value: number, deliver = false) => {
      top = value
      if (deliver) fireEvent.scroll(scroller)
    },
    measure: (changes: Array<[number, number]>, path: 'ref' | 'resize') => act(() => {
      changes.forEach(([index, height]) => { rows[index].height = height })
      const entries = changes.map(([index, height]): ResizeObserverEntry => {
        const target = scroller.querySelector(`[data-index="${index}"]`)!
        const size = [{ inlineSize: 800, blockSize: height }]
        return { target, contentRect: new DOMRect(0, rowTop(index) - top, 800, height),
          borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size }
      })
      if (path === 'ref') entries.forEach(entry => virtualizer.measureElement(entry.target))
      else for (const observer of [...observers]) {
        const watched = entries.filter(entry => observer.targets.has(entry.target))
        if (watched.length) observer.callback(watched, observer)
      }
    }),
    toBottom: () => act(() => api.scrollToBottom()),
    mediaLoad: () => act(() => api.handleMediaLoad()),
    beginMediaCorrection: () => act(() => vi.advanceTimersByTime(MEDIA_LOAD_DEBOUNCE_MS)),
    resizeViewport: (height: number) => act(() => {
      client = height
      const size = [{ inlineSize: 800, blockSize: height }]
      const entry: ResizeObserverEntry = {
        target: scroller, contentRect: new DOMRect(0, 0, 800, height),
        borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size,
      }
      for (const observer of [...observers]) {
        if (observer.targets.has(scroller)) observer.callback([entry], observer)
      }
    }),
    unmount: view.unmount,
  }
}

it.each([false, true])('does not dispatch redundant FAB updates for a stable hold (pending transition: %s)', pendingTransition => {
  const scope = fixture()
  const before = scope.renderCount
  act(() => {
    if (pendingTransition) React.startTransition(() => scope.api.setInteractionMenuOpen(true))
    else scope.api.setInteractionMenuOpen(true)
    expect(scope.api.beginInteractionHold(scope.rows[48].rowId)).toBe(true)
  })
  // One urgent retain/menu commit, plus the menu transition when requested separately.
  // A functional equality guard inside the FAB updater still causes an extra render here.
  expect(scope.renderCount - before).toBe(pendingTransition ? 2 : 1)
  expect(scope.api.showScrollToBottom).toBe(false)
  expect(scope.api.interactionMenuOpen).toBe(true)
  settle()
  for (const open of [false, true, false]) {
    const beforeMenu = scope.renderCount
    act(() => scope.api.setInteractionMenuOpen(open))
    expect(scope.renderCount - beforeMenu).toBe(1)
    expect(scope.api.showScrollToBottom).toBe(false)
  }
  settle()
})

it.each([
  { finalShow: false, transition: false },
  { finalShow: true, transition: false },
  { finalShow: false, transition: true },
  { finalShow: true, transition: true },
])('preserves opposite batched FAB requests (final: $finalShow, transition: $transition)', ({ finalShow, transition }) => {
  const scope = fixture()
  // releaseInteractionHold refreshes presentation even when there is no hold. Use it to measure
  // consecutive native positions without a pin loop or synthetic scroll event taking the pixels.
  const refresh = (show: boolean) => {
    scope.move(show ? 1000 : 4700)
    scope.api.releaseInteractionHold(false)
  }
  act(() => {
    refresh(true)
    if (transition) React.startTransition(() => refresh(false))
    else refresh(false)
    refresh(true)
    if (!finalShow) refresh(false)
  })
  expect(scope.api.showScrollToBottom).toBe(finalShow)
  // Check that deduplication agrees with committed state, not just with a stale render closure.
  act(() => refresh(!finalShow))
  expect(scope.api.showScrollToBottom).toBe(!finalShow)
  act(() => refresh(finalShow))
  expect(scope.api.showScrollToBottom).toBe(finalShow)
})

it.each([false, true])('promotes an urgent FAB request past a suspended transition (show: %s)', async show => {
  const scope = fixture()
  const refresh = (value: boolean) => {
    scope.move(value ? 1000 : 4700)
    scope.api.releaseInteractionHold(false)
  }
  if (!show) act(() => refresh(true))
  expect(scope.api.showScrollToBottom).toBe(!show)
  act(() => React.startTransition(() => {
    scope.suspend()
    refresh(show)
  }))
  // The requested value belongs to a render that has not committed.
  expect(scope.api.showScrollToBottom).toBe(!show)
  if (show) act(() => refresh(true))
  else scope.switchConversation('urgent-conversation-entry')
  // Check BEFORE resolving the suspended transition: the urgent request must not be deduplicated
  // against merely queued state. Conversation entry is an independent writer of the hidden value.
  expect(scope.api.showScrollToBottom).toBe(show)
  await scope.resolveSuspension()
  expect(scope.api.showScrollToBottom).toBe(show)
  settle()
})

it.each(['scroll', 'bottom navigation', 'conversation entry'] as const)('keeps FAB deduplication in sync after %s hides it', writer => {
  const scope = fixture()
  const refreshAway = () => {
    scope.move(1000)
    scope.api.releaseInteractionHold(false)
  }
  act(refreshAway)
  expect(scope.api.showScrollToBottom).toBe(true)
  if (writer === 'scroll') scope.move(4700, true)
  else if (writer === 'bottom navigation') scope.toBottom()
  else scope.switchConversation('another-room')
  settle()
  expect(scope.api.showScrollToBottom).toBe(false)
  act(refreshAway)
  expect(scope.api.showScrollToBottom).toBe(true)
})

it('settles React presentation updates while a message interaction is held', () => {
  const scope = fixture()
  act(() => {
    expect(scope.api.beginInteractionHold(scope.rows[48].rowId)).toBe(true)
    scope.api.setInteractionMenuOpen(true)
  })
  settle()
  for (let i = 0; i < 5; i++) {
    scope.resizeViewport(300 + i * 10)
    settle()
  }
  expect(scope.api.interactionMenuOpen).toBe(true)
})

// Native navigation wins even when compositor pixels precede the application's scroll event.
it('observes native movement before resuming a disengaged message hold', () => {
  const release = PositioningController.prototype.releaseInteractionHold
  let retainedInteractionReading = false
  vi.spyOn(PositioningController.prototype, 'releaseInteractionHold').mockImplementation(function (this: PositioningController, input) {
    release.call(this, input)
    retainedInteractionReading = this.hasInteractionPosition()
  })
  const scope = fixture()
  scope.toBottom()
  settle()
  const bottom = scope.scroller.scrollTop
  act(() => { expect(scope.api.beginInteractionHold(scope.rows[48].rowId)).toBe(true) })
  settle()
  scope.move(bottom - 100)
  scope.writes.length = 0
  act(() => scope.api.releaseInteractionHold(true))
  settle()
  // The hook uses this classification to keep the strict bottom rule during later layout changes.
  expect(retainedInteractionReading).toBe(true)
  expect(scope.scroller.scrollTop).toBe(bottom - 100)
  expect(scope.writes.every(top => top <= bottom - 100)).toBe(true)
  scope.resizeViewport(260)
  settle()
  expect(scope.scroller.scrollTop).toBe(bottom - 100)
})

// A deferred input-end sample may describe bottom before native upward pixels arrive.
it('settles input from current native geometry instead of an older bottom sample', () => {
  const bind = scrollBinding.useScrollContainerBinding
  let ports: scrollBinding.ScrollContainerBindingPorts | undefined
  vi.spyOn(scrollBinding, 'useScrollContainerBinding').mockImplementation(input => {
    ports = input
    return bind(input)
  })
  const scope = fixture()
  scope.toBottom()
  settle()
  const geometry = { top: scope.scroller.scrollTop, height: scope.scroller.scrollHeight, client: scope.scroller.clientHeight }
  act(() => { expect(scope.api.beginInteractionHold(scope.rows[48].rowId)).toBe(true) })
  settle()
  act(() => {
    ports!.observeUserInput('room', { geometry, deltaY: -100 })
    ports!.reconcileLiveEdge('viewport-resize', true)
  })
  scope.move(geometry.top - 100)
  scope.writes.length = 0
  scope.liveEdgeMeasurements.mockClear()
  act(() => ports!.observeUserInputEnd('room', geometry, true))
  expect(scope.liveEdgeMeasurements).toHaveBeenLastCalledWith(false)
  settle()
  expect(scope.scroller.scrollTop).toBe(geometry.top - 100)
  expect(scope.writes.every(top => top <= geometry.top - 100)).toBe(true)
})

describe.each(['ref', 'resize'] as const)('installed TanStack measurement through %s', path => {
  it.each([
    { location: 'below the viewport', changes: [[15, 200]] as Array<[number, number]>, expected: 1000 },
    { location: 'above the viewport', changes: [[5, 200]] as Array<[number, number]>, expected: 1100 },
    { location: 'twice above the viewport in one frame', changes: [[5, 200], [8, 200]] as Array<[number, number]>, expected: 1200 },
  ])('uses the current reading position for growth $location', ({ changes, expected }) => {
    const scope = fixture()
    const observed = vi.spyOn(PositioningController.prototype, 'observeUserScroll')
    scope.move(2000, true)
    settle()
    const controller = observed.mock.contexts.at(-1) as PositioningController
    expect(controller.snapshot().active).toBeNull()
    expect(scope.scroller.scrollTop).toBe(2000)
    scope.writes.length = 0
    scope.scrollEvents.length = 0

    scope.move(1000)
    scope.measure(changes, path)
    expect(scope.scroller.scrollTop).toBe(expected)
    expect(scope.scrollEvents).toEqual([])
    expect(controller.snapshot().active).toBeNull()
    expect(scope.loadOlder).not.toHaveBeenCalled()
    expect(scope.loadNewer).not.toHaveBeenCalled()
    expect(scope.virtualizer.getTotalSize()).toBe(scope.totalHeight())
    const visible = scope.virtualizer.getVirtualItems().find(row => row.start <= expected && row.start + row.size > expected)
    expect(visible?.key).toBe(scope.rows[10].rowId)
    expect(scope.writes.every(value => value >= 1000 && value <= expected)).toBe(true)

    scope.toBottom()
    settle()
    expect(scope.scroller.scrollTop).toBe(scope.totalHeight() - 300)
    fireEvent.scroll(scope.scroller)
    expect(scope.loadOlder).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    scope.move(80, true)
    scope.move(0, true)
    expect(scope.loadOlder).toHaveBeenCalledOnce()
    scope.unmount()
    expect(scrollStateManager.getSavedScrollTop('room')).toBe(0)
    expect(scrollStateManager.getSavedAnchor('room')).toEqual({ messageId: scope.rows[2].rowId, fraction: 1 })
    expect(getScrollShadowSnapshot().instrumentationErrors).toEqual([])
  })
})

describe('installed TanStack media preservation during viewport resize', () => {
  it.each([200, 400].flatMap(client =>
    ['settle', 'takeover', 'navigate'].map(action => ({ client, action })),
  ))('rebases the active request and pending target at $client px before $action', ({ client, action }) => {
    const scope = fixture()
    scope.move(1000, true)
    settle()
    scope.measure([[45, 200]], 'resize')
    scope.mediaLoad()
    const begun = vi.spyOn(PositioningController.prototype, 'beginMediaPreservation')
    scope.beginMediaCorrection()
    const controller = begun.mock.contexts.at(-1) as PositioningController
    const request = controller.snapshot().active!.request
    expect(request.source.kind).toBe('media-preservation')
    expect(frames.size).toBeGreaterThan(0)
    expect(scope.scroller.scrollTop).toBe(1000)
    scope.writes.length = 0
    scope.scrollEvents.length = 0

    scope.resizeViewport(client)
    expect(controller.snapshot().active?.request.generation).toBe(request.generation)
    expect(controller.snapshot().active?.request.desired).toMatchObject({
      kind: 'anchor', messageId: scope.rows[client === 200 ? 11 : 13].rowId,
    })
    if (action === 'takeover') scope.move(900)
    if (action === 'navigate') scope.toBottom()
    settle()
    const expected = action === 'navigate' ? scope.totalHeight() - client : action === 'takeover' ? 900 : 1000
    expect(scope.scroller.scrollTop).toBe(expected)
    if (action !== 'navigate') expect(scope.writes.every(value => value === expected || value === 1000)).toBe(true)
    expect(scope.scrollEvents).toEqual([])
    expect(scope.loadOlder).not.toHaveBeenCalled()
    expect(scope.loadNewer).not.toHaveBeenCalled()

    scope.measure([[5, 180]], 'resize')
    scope.mediaLoad()
    scope.beginMediaCorrection()
    settle()
    expect(scope.scroller.scrollTop).toBe(expected + 80)
    expect(scope.virtualizer.getTotalSize()).toBe(scope.totalHeight())
    act(() => vi.advanceTimersByTime(1000))
    scope.move(80, true)
    scope.move(0, true)
    expect(scope.loadOlder).toHaveBeenCalledOnce()
    scope.unmount()
    expect(scrollStateManager.getSavedAnchor('room')).toEqual({
      messageId: scope.rows[client / 100 - 1].rowId, fraction: 1,
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioNotificationPlayer, type AudioNotificationPlayer } from './audioNotificationPlayer'

class MockAudioContext {
  static instances: MockAudioContext[] = []
  state = 'running'
  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => {
    this.state = 'closed'
    return Promise.resolve()
  })

  constructor() {
    MockAudioContext.instances.push(this)
  }
}

const players: AudioNotificationPlayer[] = []
const sources: AudioScheduledSourceNode[] = []
function createPlayer() {
  const schedule = vi.fn(() => {
    const source = { onended: null } as AudioScheduledSourceNode
    sources.push(source)
    return source
  })
  const player = createAudioNotificationPlayer(schedule)
  players.push(player)
  return { player, schedule }
}
function end(source: AudioScheduledSourceNode) {
  source.onended?.call(source, new Event('ended'))
}

beforeEach(() => {
  vi.useFakeTimers()
  MockAudioContext.instances = []
  sources.length = 0
  vi.stubGlobal('AudioContext', MockAudioContext)
})
afterEach(() => {
  for (const player of players) player.dispose()
  players.length = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('audio notification output lifecycle', () => {
  it('allocates no audio output until a sound is requested', () => {
    createPlayer()
    expect(MockAudioContext.instances).toHaveLength(0)
  })

  it('closes on the final source ending without advancing a wall-clock timer', () => {
    const { player } = createPlayer()
    player.play()
    const context = MockAudioContext.instances[0]
    expect(context.close).not.toHaveBeenCalled()
    end(sources[0])
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(MockAudioContext.instances).toHaveLength(2)
  })

  it('keeps overlapping chimes alive until every final source ends', () => {
    const { player } = createPlayer()
    player.play()
    player.play()
    const context = MockAudioContext.instances[0]
    expect(MockAudioContext.instances).toHaveLength(1)
    end(sources[1])
    expect(context.close).not.toHaveBeenCalled()
    end(sources[0])
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('closes between separated sounds instead of keeping output alive for a burst', () => {
    const { player } = createPlayer()
    for (let i = 0; i < 4; i++) {
      player.play()
      end(sources[i])
      vi.advanceTimersByTime(500)
    }
    expect(MockAudioContext.instances).toHaveLength(4)
    for (const context of MockAudioContext.instances) {
      expect(context.close).toHaveBeenCalledTimes(1)
    }
  })

  it('closes on setup failure after allocation', () => {
    const { player, schedule } = createPlayer()
    schedule.mockImplementationOnce(() => { throw new Error('output unavailable') })
    expect(() => player.play()).not.toThrow()
    expect(MockAudioContext.instances[0].close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(MockAudioContext.instances).toHaveLength(2)
  })

  it('closes a context whose resume rejects', async () => {
    const { player, schedule } = createPlayer()
    schedule.mockImplementationOnce(() => {
      const context = MockAudioContext.instances[0]
      context.state = 'suspended'
      context.resume.mockRejectedValueOnce(new Error('autoplay blocked'))
      return { onended: null } as AudioScheduledSourceNode
    })
    // First play configures a suspended context; the next play resumes it.
    player.play()
    player.play()
    await Promise.resolve()
    expect(MockAudioContext.instances[0].resume).toHaveBeenCalledTimes(1)
    expect(MockAudioContext.instances[0].close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains a timeout backstop when autoplay never starts the audio clock', () => {
    const { player } = createPlayer()
    player.play()
    const context = MockAudioContext.instances[0]
    context.state = 'suspended'
    context.resume.mockReturnValue(new Promise<void>(() => {}))
    player.play()
    vi.advanceTimersByTime(1000)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(sources.every((source) => source.onended === null)).toBe(true)
  })

  it.each(['pagehide', 'freeze'])('releases output on %s before page timers are frozen', (event) => {
    const { player } = createPlayer()
    player.play()
    ;(event === 'pagehide' ? window : document).dispatchEvent(new Event(event))
    expect(MockAudioContext.instances[0].close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    player.play()
    expect(MockAudioContext.instances).toHaveLength(2)
  })

  it('ignores a late rejected resume belonging to an old context', async () => {
    const { player } = createPlayer()
    player.play()
    const old = MockAudioContext.instances[0]
    old.state = 'suspended'
    let rejectResume!: (error: Error) => void
    old.resume.mockReturnValue(new Promise<void>((_, reject) => { rejectResume = reject }))
    player.play()
    window.dispatchEvent(new Event('pagehide'))
    player.play()
    rejectResume(new Error('old autoplay failed'))
    await Promise.resolve()
    expect(MockAudioContext.instances[1].close).not.toHaveBeenCalled()
  })

  it('disposes idempotently, clears timers and listeners, and cannot play again', () => {
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const { player } = createPlayer()
    player.play()
    player.dispose()
    player.dispose()
    player.play()
    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0].close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeWindowListener).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(removeDocumentListener).toHaveBeenCalledWith('freeze', expect.any(Function))
    removeWindowListener.mockRestore()
    removeDocumentListener.mockRestore()
  })

  it('handles unavailable Web Audio without allocating output', () => {
    vi.stubGlobal('AudioContext', undefined)
    const { player } = createPlayer()
    expect(() => player.play()).not.toThrow()
    expect(MockAudioContext.instances).toHaveLength(0)
  })
})

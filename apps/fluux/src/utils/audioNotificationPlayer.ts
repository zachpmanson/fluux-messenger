export interface AudioNotificationPlayer {
  play: () => void
  dispose: () => void
}

/** Release notification output at the audio clock's end, not just a tab timer. */
export function createAudioNotificationPlayer(
  schedule: (context: AudioContext) => AudioScheduledSourceNode,
): AudioNotificationPlayer {
  let context: AudioContext | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Set<AudioScheduledSourceNode>()
  let disposed = false

  const release = () => {
    if (closeTimer !== null) clearTimeout(closeTimer)
    closeTimer = null
    for (const source of pending) source.onended = null
    pending.clear()
    const previous = context
    context = null
    void previous?.close().catch(() => {
      // A browser may already have closed the context during page teardown.
    })
  }

  // A page can be frozen before a background timeout gets a chance to run.
  window.addEventListener('pagehide', release)
  document.addEventListener('freeze', release)

  return {
    play: () => {
      if (disposed || typeof window.AudioContext === 'undefined') return
      try {
        if (!context || context.state === 'closed') {
          release()
          context = new window.AudioContext()
        }
        const current = context
        // Backstop for blocked autoplay, where the audio clock never starts.
        if (closeTimer !== null) clearTimeout(closeTimer)
        closeTimer = setTimeout(release, 1000)
        if (current.state === 'suspended') {
          void current.resume().catch(() => {
            if (context === current) release()
          })
        }
        // The scheduler returns the last source of this chime. Overlapping
        // chimes share output until all of their last sources have ended.
        const lastSource = schedule(current)
        pending.add(lastSource)
        lastSource.onended = () => {
          pending.delete(lastSource)
          lastSource.onended = null
          if (context === current && pending.size === 0) release()
        }
      } catch {
        // Setup can fail after allocation; never leave a silent output open.
        release()
      }
    },
    dispose: () => {
      disposed = true
      window.removeEventListener('pagehide', release)
      document.removeEventListener('freeze', release)
      release()
    },
  }
}

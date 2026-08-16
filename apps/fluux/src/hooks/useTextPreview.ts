import { useState, useEffect } from 'react'
import { platform } from '@/platform'

/** Maximum bytes to fetch for text preview */
const MAX_PREVIEW_BYTES = 1024

/** Maximum lines to display in preview */
const MAX_PREVIEW_LINES = 15

interface TextPreviewState {
  content: string | null
  isLoading: boolean
  error: string | null
  isTruncated: boolean
}

/**
 * Module-level cache of fetched previews, keyed by URL. TextFilePreview sits in
 * a row the virtualizer remounts freely; without this, every remount refetches
 * the Range request and toggles the loading placeholder ↔ content, swinging the
 * row height (≈48px loading vs up to 192px content) and feeding the scroll-layer
 * re-anchor loop that renders SVG previews forever. Cached content renders
 * instantly on remount, so the height is stable after the first fetch. Entry
 * size is capped (1KB fetch, ≤15 lines) and the map is FIFO-bounded.
 */
const textPreviewCache = new Map<string, { content: string; isTruncated: boolean }>()
const TEXT_PREVIEW_CACHE_MAX = 200

/** Test-only: forget all cached previews (see textPreviewCache). */
export function __resetTextPreviewCacheForTest(): void {
  textPreviewCache.clear()
}

/**
 * Fetch text content via Tauri's HTTP plugin (bypasses CORS).
 */
async function fetchViaTauri(url: string): Promise<{ text: string; isTruncated: boolean }> {
  const { fetch } = await import('@tauri-apps/plugin-http')

  // Tauri's fetch supports Range headers
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Range': `bytes=0-${MAX_PREVIEW_BYTES - 1}`,
    },
  })

  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }

  const text = await response.text()

  // Check if content was truncated
  const contentRange = response.headers.get('Content-Range')
  const wasRangeTruncated = response.status === 206 && contentRange !== null

  return { text, isTruncated: wasRangeTruncated }
}

/**
 * Fetch text content via browser fetch.
 */
async function fetchViaBrowser(url: string): Promise<{ text: string; isTruncated: boolean }> {
  const response = await fetch(url, {
    headers: {
      'Range': `bytes=0-${MAX_PREVIEW_BYTES - 1}`,
    },
  })

  if (!response.ok && response.status !== 206) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }

  const text = await response.text()

  // Check if content was truncated
  const contentRange = response.headers.get('Content-Range')
  const wasRangeTruncated = response.status === 206 && contentRange !== null

  return { text, isTruncated: wasRangeTruncated }
}

/**
 * Hook to fetch and display a text file preview.
 * Uses HTTP Range request to fetch only the first ~1KB.
 * In Tauri, uses the HTTP plugin to bypass CORS.
 */
export function useTextPreview(url: string | undefined, enabled: boolean = true): TextPreviewState {
  const [state, setState] = useState<TextPreviewState>(() => {
    const cached = url ? textPreviewCache.get(url) : undefined
    return cached
      ? { content: cached.content, isLoading: false, error: null, isTruncated: cached.isTruncated }
      : { content: null, isLoading: false, error: null, isTruncated: false }
  })

  useEffect(() => {
    if (!url || !enabled) {
      setState({ content: null, isLoading: false, error: null, isTruncated: false })
      return
    }

    // Already fetched once → render instantly, no loading toggle, no height swing.
    const cached = textPreviewCache.get(url)
    if (cached) {
      setState({ content: cached.content, isLoading: false, error: null, isTruncated: cached.isTruncated })
      return
    }

    let cancelled = false

    const fetchPreview = async () => {
      setState(s => ({ ...s, isLoading: true, error: null }))

      try {
        // Use Tauri HTTP plugin in desktop, browser fetch in web
        const { text, isTruncated: wasRangeTruncated } = platform().nativeHttpFetch
          ? await fetchViaTauri(url)
          : await fetchViaBrowser(url)

        if (cancelled) return

        // Split into lines and limit
        const lines = text.split('\n')
        const displayLines = lines.slice(0, MAX_PREVIEW_LINES)
        const wasLineTruncated = lines.length > MAX_PREVIEW_LINES
        const isTruncated = wasRangeTruncated || wasLineTruncated

        // Cache the rendered content so remounts skip the loading state entirely.
        textPreviewCache.set(url, { content: displayLines.join('\n'), isTruncated })
        if (textPreviewCache.size > TEXT_PREVIEW_CACHE_MAX) {
          const oldest = textPreviewCache.keys().next().value
          if (oldest !== undefined) textPreviewCache.delete(oldest)
        }

        setState({
          content: displayLines.join('\n'),
          isLoading: false,
          error: null,
          isTruncated,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          content: null,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load preview',
          isTruncated: false,
        })
      }
    }

    void fetchPreview()

    return () => {
      cancelled = true
    }
  }, [url, enabled])

  return state
}

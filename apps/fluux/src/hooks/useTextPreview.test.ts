import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTextPreview, __resetTextPreviewCacheForTest } from './useTextPreview'

describe('useTextPreview', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    __resetTextPreviewCacheForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    __resetTextPreviewCacheForTest()
  })

  it('should not fetch when url is undefined', () => {
    renderHook(() => useTextPreview(undefined))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should not fetch when enabled is false', () => {
    renderHook(() => useTextPreview('https://example.com/file.txt', false))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should fetch content when url is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('Hello World'),
    })

    const { result } = renderHook(() => useTextPreview('https://example.com/file.txt'))

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.content).toBe('Hello World')
    expect(result.current.error).toBeNull()
    expect(result.current.isTruncated).toBe(false)
  })

  it('should send Range header for partial content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('content'),
    })

    renderHook(() => useTextPreview('https://example.com/file.txt'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.txt', {
        headers: { 'Range': 'bytes=0-1023' },
      })
    })
  })

  it('should set isTruncated when response is partial (206)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 206,
      headers: new Headers({ 'Content-Range': 'bytes 0-1023/5000' }),
      text: () => Promise.resolve('partial content'),
    })

    const { result } = renderHook(() => useTextPreview('https://example.com/large.txt'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isTruncated).toBe(true)
  })

  it('should truncate to max 15 lines', async () => {
    const manyLines = Array(20).fill('line').join('\n')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(manyLines),
    })

    const { result } = renderHook(() => useTextPreview('https://example.com/file.txt'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const lineCount = result.current.content?.split('\n').length ?? 0
    expect(lineCount).toBe(15)
    expect(result.current.isTruncated).toBe(true)
  })

  it('should set error on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: () => Promise.resolve('Not Found'),
    })

    const { result } = renderHook(() => useTextPreview('https://example.com/missing.txt'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.content).toBeNull()
    expect(result.current.error).toBe('Failed to fetch: 404')
  })

  it('should set error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useTextPreview('https://example.com/file.txt'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.content).toBeNull()
    expect(result.current.error).toBe('Network error')
  })

  it('should reset state when url changes to undefined', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('content'),
    })

    const { result, rerender } = renderHook(
      ({ url }) => useTextPreview(url),
      { initialProps: { url: 'https://example.com/file.txt' as string | undefined } }
    )

    await waitFor(() => {
      expect(result.current.content).toBe('content')
    })

    rerender({ url: undefined })

    expect(result.current.content).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('fetches once, then serves cached content instantly on remount', async () => {
    // TextFilePreview sits in a row the virtualizer remounts freely; cached
    // content must render immediately on remount — no loading toggle, no
    // height swing, no second fetch.
    const url = 'https://example.com/cached.svg'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('line one\nline two\nline three'),
    })

    const { result, unmount } = renderHook(() => useTextPreview(url, true))

    await waitFor(() => {
      expect(result.current.content).toBe('line one\nline two\nline three')
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Simulate a virtualizer remount: new component instance, same URL.
    unmount()
    const { result: remounted } = renderHook(() => useTextPreview(url, true))
    expect(remounted.current.content).toBe('line one\nline two\nline three')
    expect(remounted.current.isLoading).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps truncation flags in the cache so remounts render identically', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 206,
      headers: new Headers({ 'Content-Range': 'bytes 0-1023/5000' }),
      text: () => Promise.resolve('partial'),
    })

    const url = 'https://example.com/large-cached.svg'
    const { result, unmount } = renderHook(() => useTextPreview(url, true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.isTruncated).toBe(true)

    unmount()
    const { result: remounted } = renderHook(() => useTextPreview(url, true))
    expect(remounted.current.isTruncated).toBe(true)
    expect(remounted.current.content).toBe('partial')
  })

  it('does not cache failed fetches', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const url = 'https://example.com/flaky.svg'
    const { result } = renderHook(() => useTextPreview(url, true))

    await waitFor(() => {
      expect(result.current.error).toBe('network down')
    })

    // A later successful fetch must retry, not serve a stale cache.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('now it works'),
    })
    const { result: retried } = renderHook(() => useTextPreview(url, true))
    await waitFor(() => {
      expect(retried.current.content).toBe('now it works')
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

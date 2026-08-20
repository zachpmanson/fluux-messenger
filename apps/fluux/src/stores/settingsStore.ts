import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type TimeFormat = '12h' | '24h' | 'auto'
export type MediaAutoDownload = 'always' | 'private-only' | 'never'
/** Motion preference: follow the OS, force full animations, or reduce them. */
export type MotionPreference = 'system' | 'full' | 'reduced'
/** Transparency preference: follow the OS, force glass frost, or reduce to solid surfaces. */
export type TransparencyMode = 'system' | 'full' | 'reduced'
/** Display density: normal spacing or compact spacing. */
export type DensityMode = 'comfortable' | 'compact'

/** Font size as percentage of default (100 = normal). Range: 75–150. */
export type FontSize = number

interface SettingsState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  timeFormat: TimeFormat
  setTimeFormat: (format: TimeFormat) => void
  fontSize: FontSize
  setFontSize: (size: FontSize) => void
  mediaAutoDownload: MediaAutoDownload
  setMediaAutoDownload: (value: MediaAutoDownload) => void
  motionPreference: MotionPreference
  setMotionPreference: (value: MotionPreference) => void
  transparencyMode: TransparencyMode
  setTransparencyMode: (value: TransparencyMode) => void
  densityMode: DensityMode
  setDensityMode: (mode: DensityMode) => void
  showStatusMessage: boolean
  setShowStatusMessage: (enabled: boolean) => void
  markdownEnabled: boolean
  setMarkdownEnabled: (enabled: boolean) => void
  /**
   * Whether to auto-send read-delivery signals (XEP-0333 displayed markers)
   * for messages the user has actually viewed, and request markers on
   * outgoing messages. Default on, matching the upstream converse fork;
   * off for users who don't want to disclose they've read something.
   */
  sendReadReceipts: boolean
  setSendReadReceipts: (enabled: boolean) => void
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  keepInSystemTray: boolean
  setKeepInSystemTray: (enabled: boolean) => void
  collapseLongMessages: boolean
  setCollapseLongMessages: (enabled: boolean) => void
}

const THEME_KEY = 'fluux-theme'
const TIME_FORMAT_KEY = 'fluux-time-format'
const FONT_SIZE_KEY = 'fluux-font-size'
const MEDIA_AUTO_DOWNLOAD_KEY = 'fluux-media-autodownload'
const MOTION_KEY = 'fluux-motion'
const TRANSPARENCY_KEY = 'fluux-transparency'
const DENSITY_KEY = 'fluux-density'
const STATUS_MESSAGE_KEY = 'fluux-status-message'
const MARKDOWN_KEY = 'fluux-markdown'
const READ_RECEIPTS_KEY = 'fluux-send-read-receipts'
const SOUND_KEY = 'fluux-sound'
const KEEP_IN_TRAY_KEY = 'fluux-keep-in-tray'
const COLLAPSE_LONG_KEY = 'fluux-collapse-long'

/**
 * Get initial theme mode from localStorage, default to 'system'
 */
function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage not available
  }
  return 'system'
}

/**
 * Get initial time format from localStorage, default to 'auto'
 */
function getInitialTimeFormat(): TimeFormat {
  try {
    const stored = localStorage.getItem(TIME_FORMAT_KEY)
    if (stored === '12h' || stored === '24h' || stored === 'auto') {
      return stored
    }
  } catch {
    // localStorage not available
  }
  return 'auto'
}

/**
 * Get initial media auto-download policy from localStorage, default to 'private-only'.
 */
function getInitialMediaAutoDownload(): MediaAutoDownload {
  try {
    const stored = localStorage.getItem(MEDIA_AUTO_DOWNLOAD_KEY)
    if (stored === 'always' || stored === 'private-only' || stored === 'never') {
      return stored
    }
  } catch {
    // localStorage not available
  }
  return 'private-only'
}

/**
 * Get initial font size from localStorage, default to 100 (normal)
 */
function getInitialFontSize(): FontSize {
  try {
    const stored = localStorage.getItem(FONT_SIZE_KEY)
    if (stored) {
      const parsed = Number(stored)
      if (parsed >= 75 && parsed <= 150) return parsed
    }
  } catch {
    // localStorage not available
  }
  return 100
}

/**
 * Get initial motion preference from localStorage, default to 'system'
 * (follow the OS prefers-reduced-motion setting).
 */
function getInitialMotion(): MotionPreference {
  try {
    const stored = localStorage.getItem(MOTION_KEY)
    if (stored === 'system' || stored === 'full' || stored === 'reduced') {
      return stored
    }
  } catch {
    // localStorage not available
  }
  return 'system'
}

/**
 * Get initial transparency preference from localStorage, default to 'system'
 * (follow the OS prefers-reduced-transparency setting).
 */
function getInitialTransparency(): TransparencyMode {
  try {
    const s = localStorage.getItem(TRANSPARENCY_KEY)
    if (s === 'system' || s === 'full' || s === 'reduced') return s
  } catch {
    // localStorage not available
  }
  return 'system'
}

/**
 * Get initial display density from localStorage, default to 'comfortable'.
 */
function getInitialDensity(): DensityMode {
  try {
    const stored = localStorage.getItem(DENSITY_KEY)
    if (stored === 'comfortable' || stored === 'compact') return stored
  } catch {
    // localStorage not available
  }
  return 'comfortable'
}

function getInitialSendReadReceipts(): boolean {
  try {
    const stored = localStorage.getItem(READ_RECEIPTS_KEY)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // localStorage not available
  }
  // Default on — matched the converse fork's behavior: receipts are sent
  // until the user opts out (the disclosure only matters when it's new).
  return true
}

/**
 * Get the initial status-message preference from localStorage, default to true.
 *
 * On: a contact's custom <status> replaces the "Online"/"Do not disturb" label
 * in the chat header and profile. Off: the show label is shown as before.
 */
function getInitialShowStatusMessage(): boolean {
  try {
    const stored = localStorage.getItem(STATUS_MESSAGE_KEY)
 * Get initial Markdown rendering preference from localStorage, default to true.
 *
 * This governs the Markdown-only block constructs (headings, lists, tables,
 * labelled links). XEP-0393 message styling — *bold*, _italic_, ~strike~,
 * `code`, ``` blocks and > quotes — is the XMPP standard for styled bodies and
 * stays on regardless.
 */
function getInitialMarkdownEnabled(): boolean {
  try {
    const stored = localStorage.getItem(MARKDOWN_KEY)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // localStorage not available
  }
  return true
}

/**
 * Get initial sound enabled preference from localStorage, default to true.
 */
function getInitialSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SOUND_KEY)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // localStorage not available
  }
  return true
}

/**
 * Keep the current close-to-tray behavior for existing desktop users until
 * they explicitly opt out.
 */
function getInitialKeepInSystemTray(): boolean {
  try {
    const stored = localStorage.getItem(KEEP_IN_TRAY_KEY)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // localStorage not available
  }
  return true
}

/**
 * Get the initial long-message collapse preference from localStorage, default to true.
 *
 * On: messages taller than the threshold collapse with a "Show more" button.
 * Off: every message renders in full — no collapsing, no button.
 */
function getInitialCollapseLongMessages(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSE_LONG_KEY)
    if (stored === 'false') return false
    if (stored === 'true') return true
  } catch {
    // localStorage not available
  }
  return true
}

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: getInitialMode(),

  setThemeMode: (mode) => {
    // Persist to localStorage
    try {
      localStorage.setItem(THEME_KEY, mode)
    } catch {
      // localStorage not available
    }
    set({ themeMode: mode })
  },

  timeFormat: getInitialTimeFormat(),

  setTimeFormat: (format) => {
    // Persist to localStorage
    try {
      localStorage.setItem(TIME_FORMAT_KEY, format)
    } catch {
      // localStorage not available
    }
    set({ timeFormat: format })
  },

  fontSize: getInitialFontSize(),

  setFontSize: (size) => {
    const clamped = Math.max(75, Math.min(150, size))
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(clamped))
    } catch {
      // localStorage not available
    }
    set({ fontSize: clamped })
  },

  mediaAutoDownload: getInitialMediaAutoDownload(),

  setMediaAutoDownload: (value) => {
    try {
      localStorage.setItem(MEDIA_AUTO_DOWNLOAD_KEY, value)
    } catch {
      // localStorage not available
    }
    set({ mediaAutoDownload: value })
  },

  motionPreference: getInitialMotion(),

  setMotionPreference: (value) => {
    try {
      localStorage.setItem(MOTION_KEY, value)
    } catch {
      // localStorage not available
    }
    set({ motionPreference: value })
  },

  transparencyMode: getInitialTransparency(),

  setTransparencyMode: (value) => {
    try { localStorage.setItem(TRANSPARENCY_KEY, value) } catch { /* */ }
    set({ transparencyMode: value })
  },

  densityMode: getInitialDensity(),

  setDensityMode: (mode) => {
    try { localStorage.setItem(DENSITY_KEY, mode) } catch { /* localStorage not available */ }
    set({ densityMode: mode })
  },

  showStatusMessage: getInitialShowStatusMessage(),

  setShowStatusMessage: (enabled) => {
    try { localStorage.setItem(STATUS_MESSAGE_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ showStatusMessage: enabled })
  markdownEnabled: getInitialMarkdownEnabled(),

  setMarkdownEnabled: (enabled) => {
    try { localStorage.setItem(MARKDOWN_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ markdownEnabled: enabled })
  sendReadReceipts: getInitialSendReadReceipts(),

  setSendReadReceipts: (enabled) => {
    try { localStorage.setItem(READ_RECEIPTS_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ sendReadReceipts: enabled })
  },

  soundEnabled: getInitialSoundEnabled(),

  setSoundEnabled: (enabled) => {
    try { localStorage.setItem(SOUND_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ soundEnabled: enabled })
  },

  keepInSystemTray: getInitialKeepInSystemTray(),

  setKeepInSystemTray: (enabled) => {
    try { localStorage.setItem(KEEP_IN_TRAY_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ keepInSystemTray: enabled })
  },

  collapseLongMessages: getInitialCollapseLongMessages(),

  setCollapseLongMessages: (enabled) => {
    try { localStorage.setItem(COLLAPSE_LONG_KEY, String(enabled)) } catch { /* localStorage not available */ }
    set({ collapseLongMessages: enabled })
  },
}))

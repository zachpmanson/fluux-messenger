import type { Contact, PresenceStatus } from '@fluux/sdk'

// Use simplified type for translation function to avoid complex i18next type issues
 
type TranslateFn = any

// Duration thresholds (in ms)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * Format a duration to a translated human-readable string
 */
function formatDuration(ms: number, t: TranslateFn): string {
  if (ms < MINUTE) return t('presence.justNow')
  if (ms < HOUR) return t('presence.minutesAgo', { count: Math.floor(ms / MINUTE) })
  if (ms < DAY) return t('presence.hoursAgo', { count: Math.floor(ms / HOUR) })
  if (ms < 2 * DAY) return t('presence.yesterday')
  if (ms < WEEK) return t('presence.daysAgo', { count: Math.floor(ms / DAY) })
  if (ms < MONTH) return t('presence.weeksAgo', { count: Math.floor(ms / WEEK) })
  if (ms < YEAR) return t('presence.monthsAgo', { count: Math.floor(ms / MONTH) })
  return t('presence.yearsAgo', { count: Math.floor(ms / YEAR) })
}

/**
 * Format idle duration to a translated string
 */
function formatIdleDuration(ms: number, t: TranslateFn): string {
  if (ms < MINUTE) return t('presence.active')
  if (ms < HOUR) return `${t('presence.idle')} ${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${t('presence.idle')} ${Math.floor(ms / HOUR)}h`
  return `${t('presence.idle')} ${Math.floor(ms / DAY)}d`
}

/**
 * Get translated presence label
 */
function getPresenceLabel(presence: PresenceStatus, t: TranslateFn): string {
  switch (presence) {
    case 'online': return t('presence.online')
    case 'away': return t('presence.away')
    case 'dnd': return t('presence.dnd')
    case 'offline': return t('presence.offline')
    default: return t('presence.offline')
  }
}

/**
 * Get translated last seen information
 */
function getLastSeenInfo(contact: Contact, t: TranslateFn): { text: string; isActive: boolean } {
  const now = Date.now()

  // Online contacts
  if (contact.presence !== 'offline') {
    // Check last interaction for idle status
    if (contact.lastInteraction) {
      const idleMs = now - contact.lastInteraction.getTime()
      const isActive = idleMs < MINUTE
      return {
        text: isActive ? t('presence.activeNow') : formatIdleDuration(idleMs, t),
        isActive
      }
    }
    // No idle info means actively using device
    return { text: t('presence.activeNow'), isActive: true }
  }

  // Offline contacts
  if (contact.lastSeen) {
    const sinceMs = now - contact.lastSeen.getTime()
    return {
      text: t('presence.lastSeen', { time: formatDuration(sinceMs, t) }),
      isActive: false
    }
  }

  // No last seen information
  return { text: t('presence.offline'), isActive: false }
}

/**
 * A contact's own `<status>` text, normalised for a single-line display, or
 * undefined when they haven't set one. Whitespace is collapsed because a status
 * may legitimately contain newlines, which would otherwise break the header's
 * one-line layout.
 */
function statusMessageOf(contact: Contact): string | undefined {
  const raw = contact.statusMessage?.replace(/\s+/g, ' ').trim()
  return raw ? raw : undefined
}

/**
 * Get translated combined status text for a contact
 * This is the translated version of getStatusText from the SDK
 *
 * When the contact has set a custom `<status>` and `preferStatusMessage` is on,
 * that message replaces the show label — "In a meeting" says everything
 * "Online" does and more, so printing both is noise. The idle / last-seen
 * suffix is untouched either way, so an offline contact who left a status reads
 * "on holiday · last seen 2h ago".
 */
export function getTranslatedStatusText(
  contact: Contact,
  t: TranslateFn,
  preferStatusMessage: boolean = true
): string {
  const statusMessage = preferStatusMessage ? statusMessageOf(contact) : undefined
  const presenceLabel = getPresenceLabel(contact.presence, t)
  const lastSeenInfo = getLastSeenInfo(contact, t)

  if (contact.presence === 'offline') {
    return statusMessage ? `${statusMessage} · ${lastSeenInfo.text}` : lastSeenInfo.text
  }

  const label = statusMessage ?? presenceLabel

  if (lastSeenInfo.isActive) {
    return label
  }

  return `${label} · ${lastSeenInfo.text}`
}

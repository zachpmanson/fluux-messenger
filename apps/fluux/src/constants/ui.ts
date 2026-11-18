/**
 * UI Constants
 *
 * Shared UI-related constants used across components.
 */

import type { PresenceStatus } from '@fluux/sdk'

/**
 * Shared colour and shape classes for presence indicators.
 */
export type PresenceDisplayStatus = PresenceStatus | 'xa'

export const PRESENCE_COLORS: Record<PresenceDisplayStatus, string> = {
  online: 'bg-fluux-green',
  away: 'bg-fluux-presence-away presence-away',
  xa: 'bg-fluux-presence-xa presence-away',
  dnd: 'presence-dnd',
  offline: 'bg-fluux-gray',
}

export const PRESENCE_CSS_VARS: Record<PresenceDisplayStatus, string> = {
  online: 'var(--fluux-presence-online)',
  away: 'var(--fluux-presence-away)',
  xa: 'var(--fluux-presence-xa)',
  dnd: 'var(--fluux-presence-dnd)',
  offline: 'var(--fluux-presence-offline)',
}

/**
 * Presence indicator color used when the app itself is offline.
 * Distinct from contact-level offline gray.
 */
export const APP_OFFLINE_PRESENCE_COLOR = 'bg-slate-500'

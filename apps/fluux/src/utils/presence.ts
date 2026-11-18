/**
 * Presence Display Utilities
 *
 * App-specific utilities for displaying XMPP presence states in the UI.
 * Generic presence utilities are in @fluux/sdk (getPresenceFromShow, etc.)
 */

import { getPresenceRank, type Contact, type PresenceShow, type PresenceStatus, type ResourcePresence } from '@fluux/sdk'
import { APP_OFFLINE_PRESENCE_COLOR, PRESENCE_COLORS, type PresenceDisplayStatus } from '../constants/ui'

/** Keep the SDK's simplified status while distinguishing XA for display only. */
export function resolvePresenceDisplay(presence?: PresenceStatus, show?: PresenceShow | null): PresenceDisplayStatus | undefined {
  if (presence === 'offline') return 'offline'
  if (show === null || show === 'chat') return 'online'
  if (show === 'away' || show === 'xa' || show === 'dnd') return show
  return presence
}

/** Use the same priority/rank/stable-tie winner as roster aggregation. */
export function getContactPresenceShow(contact?: Pick<Contact, 'presence' | 'resources'>): PresenceShow | null | undefined {
  if (!contact || contact.presence === 'offline') return undefined
  let best: ResourcePresence | undefined
  for (const resource of contact.resources?.values() ?? []) {
    if (!best || resource.priority > best.priority ||
      (resource.priority === best.priority && getPresenceRank(resource.show) < getPresenceRank(best.show))) {
      best = resource
    }
  }
  // null means observed plain-online presence; undefined means no raw metadata.
  return best ? best.show ?? null : undefined
}

export function getPresenceColor(presence: PresenceStatus, show?: PresenceShow | null, forceOffline = false): string {
  if (forceOffline) return APP_OFFLINE_PRESENCE_COLOR
  return PRESENCE_COLORS[resolvePresenceDisplay(presence, show)!]
}

/**
 * Map PresenceShow to shared presence indicator classes.
 */
export function getShowColor(show: PresenceShow | null | undefined, forceOffline = false): string {
  if (forceOffline) return APP_OFFLINE_PRESENCE_COLOR
  if (show === null || show === undefined || show === 'chat') return PRESENCE_COLORS.online
  if (show === 'away' || show === 'xa') return PRESENCE_COLORS[show]
  if (show === 'dnd') return PRESENCE_COLORS.dnd
  return 'bg-fluux-muted'
}

// Use simplified type for translation function to avoid complex i18next type issues
type TranslateFn = (key: string) => string

/**
 * Map PresenceShow to translated readable text.
 * Uses i18next translation function for localized strings.
 */
export function getTranslatedShowText(show: PresenceShow | null | undefined, t: TranslateFn, forceOffline = false): string {
  if (forceOffline) return t('presence.offline')
  if (show === null || show === undefined || show === 'chat') return t('presence.online')
  if (show === 'away' || show === 'xa') return t('presence.away')
  if (show === 'dnd') return t('presence.dnd')
  return t('contacts.unknown')
}

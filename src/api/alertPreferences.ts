import { supabase } from '@/lib/supabase';

/** A Guardian's urgent-alert choices (0043, PRD-2.0 R1.3). */
export interface AlertPreferences {
  onDuty: boolean;
  urgentAlerts: boolean;
  radiusM: number;
  /** Farthest reach for an escalated alert. At or below radiusM: none. */
  widerRadiusM: number;
  /** 'HH:MM' local time, both set or both null. */
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
  home: { lat: number; lng: number } | null;
  /** 'device' follows the phone's location; 'manual' was pinned by the user. */
  homeSource: 'device' | 'manual';
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  onDuty: true,
  urgentAlerts: true,
  radiusM: 8000,
  widerRadiusM: 20000,
  quietStart: null,
  quietEnd: null,
  timeZone: 'UTC',
  home: null,
  homeSource: 'device',
};

interface Row {
  on_duty: boolean;
  urgent_alerts: boolean;
  radius_m: number;
  wider_radius_m: number;
  quiet_start: string | null;
  quiet_end: string | null;
  time_zone: string;
  home_lat: number | null;
  home_lng: number | null;
  home_source: string;
}

/** Postgres `time` reads back as 'HH:MM:SS'; the app works in 'HH:MM'. */
function hhmm(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

export function fromRow(row: Row): AlertPreferences {
  return {
    onDuty: row.on_duty,
    urgentAlerts: row.urgent_alerts,
    radiusM: row.radius_m,
    widerRadiusM: row.wider_radius_m,
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
    timeZone: row.time_zone,
    home:
      row.home_lat !== null && row.home_lng !== null
        ? { lat: row.home_lat, lng: row.home_lng }
        : null,
    homeSource: row.home_source === 'manual' ? 'manual' : 'device',
  };
}

/** Null until the person registers a device or saves preferences. */
export async function getAlertPreferences(): Promise<AlertPreferences | null> {
  const { data, error } = await supabase
    .from('alert_preferences')
    .select(
      'on_duty, urgent_alerts, radius_m, wider_radius_m, quiet_start, quiet_end, time_zone, home_lat, home_lng, home_source',
    )
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/**
 * Save every choice at once. `pinHome` sets the alert area to that point
 * (rounded to ~110 m on the server); without it the area is left as it is.
 */
export async function saveAlertPreferences(
  prefs: Omit<AlertPreferences, 'home' | 'homeSource'>,
  pinHome?: { lat: number; lng: number },
): Promise<AlertPreferences> {
  const { data, error } = await supabase.rpc('set_alert_preferences', {
    p_on_duty: prefs.onDuty,
    p_urgent_alerts: prefs.urgentAlerts,
    p_radius_m: prefs.radiusM,
    p_wider_radius_m: prefs.widerRadiusM,
    p_time_zone: prefs.timeZone,
    ...(prefs.quietStart && prefs.quietEnd
      ? { p_quiet_start: prefs.quietStart, p_quiet_end: prefs.quietEnd }
      : {}),
    ...(pinHome ? { p_home_lat: pinHome.lat, p_home_lng: pinHome.lng } : {}),
  });
  if (error) throw error;
  return fromRow(data as Row);
}

/** The device's IANA time zone, for reading quiet hours on the server. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

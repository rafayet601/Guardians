/**
 * The inbox and alert preferences (0043, PRD-2.0 R1.3, R1.5, R1.9): the RPC
 * argument names the migration expects, how every entry reads, and the small
 * helpers the alert screen relies on.
 */
import { fromRow, saveAlertPreferences } from '@/api/alertPreferences';
import { markNotificationsRead, type InboxItem, type NotificationKind } from '@/api/notifications';
import { supabase } from '@/lib/supabase';
import { inboxCopy } from '@/utils/inboxCopy';
import { shiftHour } from '@/utils/quietHours';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;

const ROW = {
  on_duty: true,
  urgent_alerts: true,
  radius_m: 5000,
  wider_radius_m: 0,
  quiet_start: '22:00:00',
  quiet_end: '07:00:00',
  time_zone: 'Europe/London',
  home_lat: 51.5,
  home_lng: -0.12,
  home_source: 'manual',
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: ROW, error: null });
});

describe('inbox API', () => {
  it('marks the given entries read', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await expect(markNotificationsRead(['a', 'b'])).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read', { p_ids: ['a', 'b'] });
  });

  it('marks everything read when no ids are given', async () => {
    rpc.mockResolvedValue({ data: 5, error: null });
    await markNotificationsRead();
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read', {});
  });
});

describe('alert preferences API', () => {
  const prefs = {
    onDuty: true,
    urgentAlerts: false,
    radiusM: 2000,
    widerRadiusM: 15000,
    quietStart: null,
    quietEnd: null,
    timeZone: 'UTC',
  };

  it('leaves quiet hours and the home area out when they are not set', async () => {
    await saveAlertPreferences(prefs);
    expect(rpc).toHaveBeenCalledWith('set_alert_preferences', {
      p_on_duty: true,
      p_urgent_alerts: false,
      p_radius_m: 2000,
      p_wider_radius_m: 15000,
      p_time_zone: 'UTC',
    });
  });

  it('sends quiet hours and a pinned home area when given', async () => {
    await saveAlertPreferences(
      { ...prefs, quietStart: '22:00', quietEnd: '07:00' },
      { lat: 40.1, lng: -73.9 },
    );
    expect(rpc).toHaveBeenCalledWith(
      'set_alert_preferences',
      expect.objectContaining({
        p_quiet_start: '22:00',
        p_quiet_end: '07:00',
        p_home_lat: 40.1,
        p_home_lng: -73.9,
      }),
    );
  });

  it('reads the saved row in the shape the screen uses', () => {
    expect(fromRow(ROW)).toEqual({
      onDuty: true,
      urgentAlerts: true,
      radiusM: 5000,
      widerRadiusM: 0,
      quietStart: '22:00',
      quietEnd: '07:00',
      timeZone: 'Europe/London',
      home: { lat: 51.5, lng: -0.12 },
      homeSource: 'manual',
    });
    expect(
      fromRow({ ...ROW, home_lat: null, home_lng: null, quiet_start: null, quiet_end: null }),
    ).toMatchObject({ home: null, quietStart: null, quietEnd: null });
  });
});

const KINDS: NotificationKind[] = [
  'urgent_sighting',
  'sighting_claimed',
  'rescue_completed',
  'adoption_interest',
  'case_status',
  'screening_decided',
  'adoption_approved',
  'adoption_declined',
  'new_comment',
  'ops_job_failed',
  'claim_expiring',
  'claim_expired',
  'claim_reopened',
  'urgent_unclaimed',
  'urgent_no_responder',
];

function item(
  kind: NotificationKind,
  detail: InboxItem['detail'] = {},
  title: string | null = 'Hurt tabby',
): Pick<InboxItem, 'kind' | 'detail' | 'sighting'> {
  return { kind, detail, sighting: title === null ? null : { id: 's', title, status: 'spotted' } };
}

describe('inboxCopy', () => {
  it('has words for every kind, with a named cat, an untitled one, or a hidden report', () => {
    for (const kind of KINDS) {
      for (const sighting of ['Hurt tabby', '  ', null]) {
        const copy = inboxCopy(item(kind, {}, sighting));
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.body.length).toBeGreaterThan(0);
        expect(copy.body).not.toMatch(/undefined|null|“”/);
      }
    }
  });

  it('names the cat when the report has a title', () => {
    expect(inboxCopy(item('new_comment')).body).toContain('“Hurt tabby”');
  });

  it('tells the wider-ring alert apart from the first one', () => {
    expect(inboxCopy(item('urgent_sighting', { step: 1 })).title).toBe(
      'A cat near you needed urgent help',
    );
    expect(inboxCopy(item('urgent_sighting', { step: 2 })).title).toBe(
      'A cat still needed urgent help',
    );
  });

  it('words each status update from the status it recorded', () => {
    const titles = ['spotted', 'in_rescue', 'available', 'adopted', 'archived'].map(
      (status) => inboxCopy(item('case_status', { status })).title,
    );
    expect(new Set(titles).size).toBe(5);
    expect(inboxCopy(item('case_status', { status: 'adopted' })).title).toBe('Adopted');
  });

  it('words each screening decision from the decision it recorded', () => {
    expect(inboxCopy(item('screening_decided', { status: 'approved' }, null)).title).toBe(
      'You were cleared to adopt',
    );
    expect(inboxCopy(item('screening_decided', { status: 'rejected' }, null)).title).toBe(
      'Your background check was not approved',
    );
  });

  it('marks urgent alerts so they stand out', () => {
    expect(inboxCopy(item('urgent_sighting')).urgent).toBe(true);
    expect(inboxCopy(item('sighting_claimed')).urgent).toBe(false);
  });
});

describe('shiftHour', () => {
  it('moves by whole hours and wraps at midnight', () => {
    expect(shiftHour('22:00', 1)).toBe('23:00');
    expect(shiftHour('23:00', 1)).toBe('00:00');
    expect(shiftHour('00:00', -1)).toBe('23:00');
    expect(shiftHour('07:30', 0)).toBe('07:00');
  });
});

import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  type AlertPreferences,
  DEFAULT_ALERT_PREFERENCES,
  deviceTimeZone,
} from '@/api/alertPreferences';
import { PressableScale } from '@/components/PressableScale';
import { Button, Loading, QueryNotice, Text } from '@/components/ui';
import { useAlertPreferences, useSaveAlertPreferences } from '@/hooks/useAlertPreferences';
import { useCurrentLocation } from '@/hooks/useLocation';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, radius, shadow, spacing } from '@/theme';
import { shiftHour } from '@/utils/quietHours';

const RADII_KM = [1, 2, 5, 8] as const;
const WIDER_KM = [0, 15, 20] as const;
const DEFAULT_QUIET = { start: '22:00', end: '07:00' };

/** PRD-2.0 R1.3: where, when and which urgent alerts reach this Guardian. */
export default function AlertSettingsScreen() {
  const saved = useAlertPreferences();
  const save = useSaveAlertPreferences();
  const location = useCurrentLocation();
  // Unsaved edits, layered over what the server has (or the defaults).
  const [edits, setEdits] = useState<Partial<AlertPreferences>>({});
  const [pinHome, setPinHome] = useState<{ lat: number; lng: number } | null>(null);

  if (saved.isLoading) return <Loading label="Loading your alert settings…" />;

  const prefs: AlertPreferences = { ...(saved.data ?? DEFAULT_ALERT_PREFERENCES), ...edits };
  const set = (patch: Partial<AlertPreferences>) => setEdits((e) => ({ ...e, ...patch }));
  const quietOn = prefs.quietStart !== null && prefs.quietEnd !== null;
  const hasArea = pinHome !== null || prefs.home !== null;

  const useHere = async () => {
    const here = await location.request();
    if (!here) {
      notify('Location unavailable', 'Allow location access to set your alert area.');
      return;
    }
    setPinHome(here);
  };

  const onSave = () => {
    save.mutate(
      {
        prefs: {
          onDuty: prefs.onDuty,
          urgentAlerts: prefs.urgentAlerts,
          radiusM: prefs.radiusM,
          widerRadiusM: prefs.widerRadiusM,
          quietStart: prefs.quietStart,
          quietEnd: prefs.quietEnd,
          // Quiet hours are read in the phone's current zone.
          timeZone: deviceTimeZone(),
        },
        pinHome: pinHome ?? undefined,
      },
      {
        onSuccess: () => {
          setEdits({});
          setPinHome(null);
          notify('Saved', 'Your alert settings are updated.');
        },
        onError: (e) => notify('Could not save', getErrorMessage(e, 'Please try again.')),
      },
    );
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {saved.error ? (
        <QueryNotice
          message="Could not load your saved settings."
          onRetry={() => void saved.refetch()}
        />
      ) : null}

      <ToggleRow
        title="On duty"
        detail="Off duty, you get no urgent alerts at all. Updates about your own cases still arrive."
        value={prefs.onDuty}
        onChange={(onDuty) => set({ onDuty })}
      />
      <ToggleRow
        title="Urgent rescue alerts"
        detail="Injured cats and cats in danger near your alert area."
        value={prefs.urgentAlerts}
        onChange={(urgentAlerts) => set({ urgentAlerts })}
      />

      <View style={styles.card}>
        <Text variant="bodyStrong">Alert area</Text>
        <Text variant="small" muted>
          {pinHome
            ? 'Set to where you are now. Save to keep it.'
            : !prefs.home
              ? 'No alert area yet. Set one so alerts can reach you.'
              : prefs.homeSource === 'manual'
                ? 'Pinned where you chose. It does not move with your phone.'
                : 'Follows where your phone last opened Guardians.'}
        </Text>
        <Button
          title={hasArea ? 'Set to where I am now' : 'Use my location'}
          variant="outline"
          size="sm"
          loading={location.status === 'loading'}
          onPress={useHere}
          style={styles.start}
        />
        <Text variant="small" muted>
          We store your area rounded to about 100 m and never show it to anyone.
        </Text>
      </View>

      <View style={styles.card}>
        <Text variant="bodyStrong">Alert me within</Text>
        <ChipRow
          options={RADII_KM.map((km) => ({ value: km * 1000, label: `${km} km` }))}
          selected={prefs.radiusM}
          onSelect={(radiusM) => set({ radiusM })}
        />
        <Text variant="bodyStrong" style={styles.gapTop}>
          When nobody nearer responds, reach me up to
        </Text>
        <ChipRow
          options={WIDER_KM.map((km) => ({
            value: km * 1000,
            label: km === 0 ? 'Off' : `${km} km`,
          }))}
          selected={prefs.widerRadiusM}
          onSelect={(widerRadiusM) => set({ widerRadiusM })}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.flexText}>
            <Text variant="bodyStrong">Quiet hours</Text>
            <Text variant="small" muted>
              Alerts in quiet hours wait silently in your inbox.
            </Text>
          </View>
          <Switch
            value={quietOn}
            onValueChange={(on) =>
              set(
                on
                  ? { quietStart: DEFAULT_QUIET.start, quietEnd: DEFAULT_QUIET.end }
                  : { quietStart: null, quietEnd: null },
              )
            }
            trackColor={{ true: colors.primaryLight, false: colors.border }}
            thumbColor={colors.white}
            accessibilityRole="switch"
            accessibilityState={{ checked: quietOn }}
            accessibilityLabel="Quiet hours"
          />
        </View>
        {quietOn ? (
          <>
            <HourStepper
              label="From"
              value={prefs.quietStart!}
              onChange={(quietStart) => set({ quietStart })}
            />
            <HourStepper
              label="Until"
              value={prefs.quietEnd!}
              onChange={(quietEnd) => set({ quietEnd })}
            />
            {prefs.quietStart === prefs.quietEnd ? (
              <Text variant="small" color={colors.urgent}>
                Start and end are the same, so quiet hours won't apply. Pick two different times.
              </Text>
            ) : null}
          </>
        ) : null}
      </View>

      <Text variant="small" muted>
        Every alert also lands in your inbox, even with notifications turned off on this phone.
      </Text>

      <Button title="Save" size="lg" fullWidth loading={save.isPending} onPress={onSave} />
    </ScrollView>
  );
}

function ToggleRow(props: {
  title: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.card, styles.row]}>
      <View style={styles.flexText}>
        <Text variant="bodyStrong">{props.title}</Text>
        <Text variant="small" muted>
          {props.detail}
        </Text>
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ true: colors.primaryLight, false: colors.border }}
        thumbColor={colors.white}
        accessibilityRole="switch"
        accessibilityState={{ checked: props.value }}
        accessibilityLabel={props.title}
      />
    </View>
  );
}

function ChipRow(props: {
  options: { value: number; label: string }[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  return (
    <View style={styles.chips}>
      {props.options.map((o) => {
        const active = o.value === props.selected;
        return (
          <PressableScale
            key={o.value}
            onPress={() => props.onSelect(o.value)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
          >
            <Text variant="smallStrong" color={active ? colors.white : colors.text}>
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function HourStepper(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.row}>
      <Text variant="body" style={styles.flexText}>
        {props.label}
      </Text>
      <PressableScale
        onPress={() => props.onChange(shiftHour(props.value, -1))}
        style={styles.step}
        accessibilityRole="button"
        accessibilityLabel={`${props.label} one hour earlier`}
      >
        <Text variant="bodyStrong">−</Text>
      </PressableScale>
      <Text
        variant="bodyStrong"
        style={styles.hour}
        accessibilityLabel={`${props.label} ${props.value}`}
      >
        {props.value}
      </Text>
      <PressableScale
        onPress={() => props.onChange(shiftHour(props.value, 1))}
        style={styles.step}
        accessibilityRole="button"
        accessibilityLabel={`${props.label} one hour later`}
      >
        <Text variant="bodyStrong">+</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexText: { flex: 1, gap: 2 },
  start: { alignSelf: 'flex-start' },
  gapTop: { marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  step: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  hour: { minWidth: 56, textAlign: 'center' },
});

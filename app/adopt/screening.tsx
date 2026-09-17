import { zodResolver } from '@hookform/resolvers/zod';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Switch, View } from 'react-native';
import { z } from 'zod';

import { Button, Card, Input, Loading, Screen, Text } from '@/components/ui';
import { submitScreening, uploadScreeningDoc } from '@/api/screening';
import { useMyScreening, useStartIdVerification, useSubmitScreening } from '@/hooks/useScreening';
import { choosePhotoSource, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, layout, spacing } from '@/theme';
import { isScreeningCleared } from '@/types/models';

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function ageOn(dob: string): number | null {
  if (!DOB_RE.test(dob)) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

const schema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full legal name'),
    dob: z
      .string()
      .trim()
      .regex(DOB_RE, 'Use YYYY-MM-DD')
      .refine((v) => ageOn(v) !== null, 'Enter a valid date')
      .refine((v) => (ageOn(v) ?? 0) >= 18, 'You must be 18 or older to adopt'),
    phone: z.string().trim().min(6, 'Enter a contact phone number'),
    address_line: z.string().trim().min(3, 'Street address is required'),
    city: z.string().trim().min(2, 'City is required'),
    postal: z.string().trim().min(3, 'Postal code is required'),
    housing: z.enum(['own', 'rent', 'other']),
    landlord_permission: z.boolean().nullable().optional(),
    household_adults: z.coerce.number().int().min(1).max(20),
    household_children: z.coerce.number().int().min(0).max(20),
    other_pets: z.boolean(),
    pets_details: z.string().optional().default(''),
    vet_name: z.string().optional().default(''),
    vet_phone: z.string().optional().default(''),
    experience: z.string().optional().default(''),
    hours_alone: z.coerce.number().int().min(0).max(24),
    home_visit_consent: z.boolean(),
    cruelty_attestation: z
      .boolean()
      .refine((v) => v === true, 'This confirmation is required'),
    consent: z.boolean().refine((v) => v === true, 'Background-check consent is required'),
  })
  .refine(
    (v) => v.housing !== 'rent' || v.landlord_permission === true,
    {
      message: 'Landlord permission is required when renting',
      path: ['landlord_permission'],
    },
  );

type FormInput = z.input<typeof schema>;

interface DocAsset {
  uri: string;
  mimeType?: string | null;
  base64?: string | null;
}

export default function ScreeningScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const screeningQuery = useMyScreening();
  const submit = useSubmitScreening();
  const verify = useStartIdVerification();
  const [docs, setDocs] = useState<DocAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [housing, setHousing] = useState<'own' | 'rent' | 'other'>('own');

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: '',
      dob: '',
      phone: '',
      address_line: '',
      city: '',
      postal: '',
      housing: 'own',
      landlord_permission: null,
      household_adults: 1,
      household_children: 0,
      other_pets: false,
      pets_details: '',
      vet_name: '',
      vet_phone: '',
      experience: '',
      hours_alone: 4,
      home_visit_consent: false,
      cruelty_attestation: false,
      consent: false,
    },
  });

  const existing = screeningQuery.data ?? null;
  const cleared = isScreeningCleared(existing);

  const pickDoc = async () => {
    if (docs.length >= 2) {
      notify('Two documents max', 'A front and back photo of your ID is enough.');
      return;
    }
    const source = await choosePhotoSource();
    if (!source) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            base64: true,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    setDocs((d) => [...d, { uri: a.uri, mimeType: a.mimeType, base64: a.base64 }]);
  };

  const onSubmit = async (values: FormInput) => {
    if (!user || busy) return;
    setBusy(true);
    // z.coerce.number() accepts unknown input — normalize here for the payload.
    const householdAdults = Number(values.household_adults);
    const householdChildren = Number(values.household_children);
    const hoursAlone = Number(values.hours_alone);
    try {
      // 1. Upload ID docs to the private vault (optional but recommended).
      const paths: string[] = [];
      for (const d of docs) {
        paths.push(await uploadScreeningDoc(user.id, d));
      }
      // 2. Submit the questionnaire (server scores it deterministically).
      const screening = await submitScreening({
        full_name: values.full_name.trim(),
        dob: values.dob.trim(),
        phone: values.phone.trim(),
        address_line: values.address_line.trim(),
        city: values.city.trim(),
        postal: values.postal.trim(),
        housing: values.housing,
        landlord_permission: values.landlord_permission,
        household_adults: householdAdults,
        household_children: householdChildren,
        other_pets: values.other_pets,
        pets_details: values.pets_details?.trim(),
        vet_name: values.vet_name?.trim(),
        vet_phone: values.vet_phone?.trim(),
        experience: values.experience?.trim(),
        hours_alone: hoursAlone,
        home_visit_consent: values.home_visit_consent,
        cruelty_attestation: values.cruelty_attestation,
        consent: values.consent,
        id_doc_paths: paths,
      });
      // 3. Start ID verification (manual review queue in v1).
      try {
        await verify.mutateAsync(paths);
      } catch {
        // Non-fatal: the screening row already exists and can be verified later.
      }
      await screeningQuery.refetch();
      if (screening.status === 'rejected') {
        notify(
          'Could not approve automatically',
          screening.reasons.join('\n') || 'Please review your answers and try again.',
        );
      } else if (screening.status === 'needs_review') {
        notify(
          'Submitted — quick review needed',
          'Thanks! A moderator will review your application shortly.',
        );
        router.back();
      } else {
        notify(
          'Background check submitted',
          'Your answers look good. We will notify you once ID review clears.',
        );
        router.back();
      }
    } catch (e) {
      notify('Could not submit', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (screeningQuery.isLoading) return <Loading label="Loading your screening…" />;

  return (
    <Screen scroll contentContainerStyle={styles.page}>
      <Text variant="heading">Adoption background check</Text>
      <Text variant="small" muted>
        Standard screening before you can adopt: identity, home, and pet history. Your details
        stay private — listers only see whether you are cleared.
      </Text>

      {existing ? (
        <Card style={styles.statusCard}>
          <Text variant="bodyStrong">
            {cleared
              ? '✅ Cleared — you can adopt'
              : existing.status === 'approved'
                ? 'Approved — finishing ID verification'
                : existing.status === 'pending'
                  ? '⏳ Submitted — ID review pending'
                  : existing.status === 'needs_review'
                    ? '👀 Needs a quick manual review'
                    : existing.status === 'rejected'
                      ? '❌ Not approved'
                      : 'Expired — please re-submit below'}
          </Text>
          {existing.reasons.length > 0 && !cleared ? (
            <Text variant="small" muted>
              {existing.reasons.join('\n')}
            </Text>
          ) : null}
          {existing.expires_at && cleared ? (
            <Text variant="small" muted>
              Valid until {new Date(existing.expires_at).toLocaleDateString()}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Text variant="bodyStrong">Identity</Text>
      <Controller
        control={control}
        name="full_name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Full legal name"
            placeholder="Jordan Rivera"
            autoCapitalize="words"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.full_name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="dob"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Date of birth"
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            value={String(value ?? '')}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.dob?.message}
            hint="You must be 18 or older"
          />
        )}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Phone"
            placeholder="+1 555 0100"
            keyboardType="phone-pad"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.phone?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="address_line"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Street address"
            placeholder="123 Maple St, Apt 4"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.address_line?.message}
          />
        )}
      />
      <View style={styles.row}>
        <View style={styles.half}>
          <Controller
            control={control}
            name="city"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="City"
                placeholder="Portland"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.city?.message}
              />
            )}
          />
        </View>
        <View style={styles.half}>
          <Controller
            control={control}
            name="postal"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Postal code"
                placeholder="97201"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.postal?.message}
              />
            )}
          />
        </View>
      </View>

      <Text variant="bodyStrong">Home & pets</Text>
      <Controller
        control={control}
        name="housing"
        render={({ field: { onChange, value } }) => (
          <View style={styles.row}>
            {(['own', 'rent', 'other'] as const).map((h) => (
              <View key={h} style={styles.half}>
                <Button
                  title={h === 'own' ? 'Own' : h === 'rent' ? 'Rent' : 'Other'}
                  variant={value === h ? 'primary' : 'outline'}
                  size="sm"
                  fullWidth
                  onPress={() => {
                    setHousing(h);
                    onChange(h);
                  }}
                />
              </View>
            ))}
          </View>
        )}
      />
      {housing === 'rent' ? (
        <Controller
          control={control}
          name="landlord_permission"
          render={({ field: { onChange, value } }) => (
            <View style={styles.switchRow}>
              <Text variant="body" style={styles.switchLabel}>
                My landlord allows cats
              </Text>
              <Switch value={value === true} onValueChange={onChange} />
            </View>
          )}
        />
      ) : null}
      {errors.landlord_permission?.message ? (
        <Text variant="small" color={colors.danger}>
          {errors.landlord_permission.message}
        </Text>
      ) : null}

      <View style={styles.row}>
        <View style={styles.half}>
          <Controller
            control={control}
            name="household_adults"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Adults at home"
                keyboardType="number-pad"
                value={String(value ?? '')}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.household_adults?.message}
              />
            )}
          />
        </View>
        <View style={styles.half}>
          <Controller
            control={control}
            name="household_children"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Children at home"
                keyboardType="number-pad"
                value={String(value ?? '')}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.household_children?.message}
              />
            )}
          />
        </View>
      </View>

      <Controller
        control={control}
        name="other_pets"
        render={({ field: { onChange, value } }) => (
          <View style={styles.switchRow}>
            <Text variant="body" style={styles.switchLabel}>
              Other pets at home
            </Text>
            <Switch value={value} onValueChange={onChange} />
          </View>
        )}
      />
      <Controller
        control={control}
        name="pets_details"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Current pets (optional)"
            placeholder="e.g. 1 senior dog, friendly with cats"
            multiline
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
          />
        )}
      />
      <Controller
        control={control}
        name="vet_name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Vet reference (required with other pets)"
            placeholder="Clinic name"
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
          />
        )}
      />
      <Controller
        control={control}
        name="vet_phone"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Vet phone (optional)"
            keyboardType="phone-pad"
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
          />
        )}
      />
      <Controller
        control={control}
        name="experience"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Cat experience (optional)"
            placeholder="e.g. grew up with cats, first-time adopter…"
            multiline
            value={value ?? ''}
            onChangeText={onChange}
            onBlur={onBlur}
          />
        )}
      />
      <Controller
        control={control}
        name="hours_alone"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label="Hours the cat would be alone daily"
            keyboardType="number-pad"
            value={String(value ?? '')}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.hours_alone?.message}
            hint="Over 10 hours triggers a manual review"
          />
        )}
      />

      <Text variant="bodyStrong">ID documents</Text>
      <Text variant="small" muted>
        A front and back photo of a government ID speeds up verification. Stored privately —
        never shown to listers.
      </Text>
      <View style={styles.row}>
        <Button
          title={docs.length > 0 ? `📷 ${docs.length}/2 added — add another` : '📷 Add ID photo'}
          variant="outline"
          size="sm"
          fullWidth
          disabled={docs.length >= 2}
          onPress={pickDoc}
        />
      </View>
      {docs.length > 0 ? (
        <Button
          title="Remove ID photos"
          variant="ghost"
          size="sm"
          onPress={() => setDocs([])}
        />
      ) : null}

      <Text variant="bodyStrong">Consents</Text>
      <Controller
        control={control}
        name="home_visit_consent"
        render={({ field: { onChange, value } }) => (
          <View style={styles.switchRow}>
            <Text variant="body" style={styles.switchLabel}>
              I agree to a home visit if requested
            </Text>
            <Switch value={value} onValueChange={onChange} />
          </View>
        )}
      />
      <Controller
        control={control}
        name="cruelty_attestation"
        render={({ field: { onChange, value } }) => (
          <View>
            <View style={styles.switchRow}>
              <Text variant="body" style={styles.switchLabel}>
                I confirm I have no animal-cruelty convictions
              </Text>
              <Switch value={value} onValueChange={onChange} />
            </View>
            {errors.cruelty_attestation?.message ? (
              <Text variant="small" color={colors.danger}>
                {errors.cruelty_attestation.message}
              </Text>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="consent"
        render={({ field: { onChange, value } }) => (
          <View>
            <View style={styles.switchRow}>
              <Text variant="body" style={styles.switchLabel}>
                I consent to this background check and to storing my details for 12 months
              </Text>
              <Switch value={value} onValueChange={onChange} />
            </View>
            {errors.consent?.message ? (
              <Text variant="small" color={colors.danger}>
                {errors.consent.message}
              </Text>
            ) : null}
          </View>
        )}
      />

      <Button
        title="Submit background check"
        size="lg"
        fullWidth
        loading={busy || submit.isPending}
        onPress={handleSubmit(onSubmit)}
        style={styles.submit}
      />
      <Text variant="caption" muted center>
        Screenings are valid for 12 months. You can delete your account anytime in Settings —
        your screening and ID documents are removed with it.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: layout.formMax,
    alignSelf: 'center',
    gap: spacing.md,
  },
  statusCard: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  switchLabel: { flex: 1 },
  submit: { marginTop: spacing.sm },
});

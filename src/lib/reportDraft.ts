import { z } from 'zod';

const draftSchema = z.object({
  title: z.string(),
  description: z.string(),
  color: z.string(),
  temperament: z.enum(['friendly', 'shy', 'feral', 'unknown']),
  isInjured: z.boolean(),
  needsUrgent: z.boolean(),
  marker: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .nullable(),
});

export type ReportDraft = z.infer<typeof draftSchema>;

export const emptyReportDraft = (): ReportDraft => ({
  title: '',
  description: '',
  color: '',
  temperament: 'unknown',
  isInjured: false,
  needsUrgent: false,
  marker: null,
});

export function hasReportDraft(draft: ReportDraft): boolean {
  return !!(
    draft.title ||
    draft.description ||
    draft.color ||
    draft.marker ||
    draft.temperament !== 'unknown' ||
    draft.isInjured ||
    draft.needsUrgent
  );
}

interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

/** Serialize operations per account so a late autosave cannot resurrect a cleared draft. */
export function createReportDraftStore(storage: DraftStorage) {
  const pending = new Map<string, Promise<unknown>>();
  function enqueue<T>(userId: string, operation: (key: string) => Promise<T>): Promise<T> {
    const key = `guardians:report-draft:v1:${userId}`;
    const task = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => operation(key));
    pending.set(key, task);
    void task.then(
      () => {
        if (pending.get(key) === task) pending.delete(key);
      },
      () => {
        if (pending.get(key) === task) pending.delete(key);
      },
    );
    return task;
  }
  return {
    load: (userId: string) =>
      enqueue(userId, async (key) => {
        const raw = await storage.getItem(key);
        if (!raw) return null;
        try {
          return draftSchema.parse(JSON.parse(raw));
        } catch {
          throw new Error('Saved draft could not be read.');
        }
      }),
    save: (userId: string, draft: ReportDraft) => {
      // Parse strips unknown fields, including temporary photos and base64 data.
      const value = JSON.stringify(draftSchema.parse(draft));
      return enqueue(userId, (key) => storage.setItem(key, value));
    },
    clear: (userId: string) => enqueue(userId, (key) => storage.removeItem(key)),
  };
}

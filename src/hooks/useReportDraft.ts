import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

import { createReportDraftStore, emptyReportDraft, hasReportDraft } from '@/lib/reportDraft';

const store = createReportDraftStore(AsyncStorage);

/** Mount with an account key: drafts must never migrate between signed-in users. */
export function useReportDraft(userId?: string) {
  const [draft, setDraft] = useState(emptyReportDraft);
  const [ready, setReady] = useState(!userId);
  const [restored, setRestored] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const suspended = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    void store
      .load(userId)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setDraft(saved);
          setRestored(true);
        }
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        // Don't overwrite an unreadable draft with a blank form during hydration.
        suspended.current = true;
        setSaveStatus('error');
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!ready || !userId || suspended.current) return;
    const current = ++revision.current;
    setSaveStatus('saving');
    const operation = hasReportDraft(draft) ? store.save(userId, draft) : store.clear(userId);
    void operation
      .then(() => {
        if (current === revision.current) setSaveStatus(hasReportDraft(draft) ? 'saved' : 'idle');
      })
      .catch(() => {
        if (current === revision.current) setSaveStatus('error');
      });
  }, [draft, ready, userId]);

  const clear = async (completed = false) => {
    suspended.current = true;
    ++revision.current;
    try {
      if (userId) await store.clear(userId);
      setDraft(emptyReportDraft());
      setRestored(false);
      setSaveStatus('idle');
    } catch (error) {
      setSaveStatus('error');
      throw error;
    } finally {
      suspended.current = completed;
    }
  };

  return { draft, setDraft, ready, restored, saveStatus, clear };
}

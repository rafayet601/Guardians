import { useQueryClient } from '@tanstack/react-query';
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { captureAccountCacheGuard, createAccountCacheBoundary } from '@/lib/accountCache';
import { setPushAccount, unregisterForPush } from '@/lib/push';
import { captureError, track } from '@/lib/observability';
import { supabase } from '@/lib/supabase';

interface SignUpParams {
  email: string;
  password: string;
  username: string;
  fullName?: string;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;
    const updateCacheIdentity = createAccountCacheBoundary(queryClient);
    const publishSession = (next: Session | null) => {
      if (!active) return;
      updateCacheIdentity(next?.user.id ?? null);
      setPushAccount(next?.user.id ?? null);
      setSession(next);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active || authEventReceived) return;
        publishSession(data.session);
      })
      .catch((err) => {
        captureError(err, { source: 'auth-initialization' });
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      authEventReceived = true;
      publishSession(newSession);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    // A confirmation dialog can retain this context's action after an account
    // changes. Reject that stale action before touching the current session.
    const isCurrentSession = captureAccountCacheGuard(queryClient);
    return {
      session,
      user: session?.user ?? null,
      initializing,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        track('sign_in'); // fire-and-forget funnel event
      },
      async signUp({ email, password, username, fullName }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username, full_name: fullName ?? null },
            emailRedirectTo: Linking.createURL('/confirm'),
          },
        });
        if (error) throw error;
        track('sign_up'); // fire-and-forget funnel event
        // When email confirmation is on, there's no active session yet.
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        if (!isCurrentSession())
          throw new Error('Your account changed. Please try signing out again.');
        const isCurrentAccount = captureAccountCacheGuard(queryClient);
        if (session?.user.id) await unregisterForPush(session.user.id);
        if (!isCurrentAccount())
          throw new Error('Your account changed. Please try signing out again.');
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
      async resendConfirmation(email) {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: Linking.createURL('/confirm') },
        });
        if (error) throw error;
      },
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: Linking.createURL('/reset'),
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      },
      async deleteAccount() {
        // Permanently deletes the auth user (cascades all data) via the
        // `delete-account` Edge Function, then clears the local session.
        if (!isCurrentSession())
          throw new Error('Your account changed. Please review the account before deleting it.');
        if (!session?.access_token) throw new Error('Not authenticated');
        const isCurrentAccount = captureAccountCacheGuard(queryClient);
        if (session?.user.id) await unregisterForPush(session.user.id);
        if (!isCurrentAccount())
          throw new Error('Your account changed. Please review the account before deleting it.');
        // Bind erasure to the account that authorized it. The shared client's
        // asynchronous token lookup must not substitute a newer account token.
        const { error } = await supabase.functions.invoke('delete-account', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (error) throw error;
        // Deleting the old account must never sign out a newer account that
        // became active while the authenticated deletion request was in flight.
        if (!isCurrentAccount()) return;
        try {
          const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
          if (signOutError) throw signOutError;
        } catch {
          throw new Error(
            'Your account was deleted, but this device could not clear its session. Reconnect and sign out to finish clearing this device.',
          );
        }
      },
    };
  }, [session, initializing, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

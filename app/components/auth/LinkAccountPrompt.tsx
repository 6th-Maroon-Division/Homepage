'use client';

import { signIn } from 'next-auth/react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export default function LinkAccountPrompt() {
  const { status } = useSession();
  const [hasSteam, setHasSteam] = useState(false);
  const [hasDiscord, setHasDiscord] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }

    let cancelled = false;

    const refreshProviders = async () => {
      try {
        const res = await fetch('/api/user/auth-providers', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Failed to fetch auth providers');
        }

        const data: { providers?: string[] } = await res.json();
        const providers = Array.isArray(data.providers) ? data.providers : [];

        if (!cancelled) {
          setHasSteam(providers.includes('steam'));
          setHasDiscord(providers.includes('discord'));
        }
      } catch {
        if (!cancelled) {
          setHasSteam(false);
          setHasDiscord(false);
        }
      } finally {
        if (!cancelled) {
          setProvidersLoaded(true);
        }
      }
    };

    void refreshProviders();

    // Keep state fresh while user completes OAuth linking in another tab/window.
    const intervalId = window.setInterval(() => {
      void refreshProviders();
    }, 3000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshProviders();
      }
    };

    const onWindowFocus = () => {
      void refreshProviders();
    };

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status]);

  // Block the app for authenticated users missing either Steam or Discord.
  if (status !== 'authenticated' || !providersLoaded || (hasSteam && hasDiscord)) {
    return null;
  }

  const missingProvider = !hasSteam ? 'Steam' : 'Discord';
  const linkUrl = missingProvider === 'Steam' ? '/api/auth/steam-login' : undefined;

  const handleDiscordSignIn = async () => {
    if (typeof window === 'undefined') return;
    await signIn('discord', { callbackUrl: window.location.href });
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-lg border-2 border-yellow-400 bg-yellow-50 p-6 text-center shadow-2xl dark:border-yellow-600 dark:bg-yellow-900/20">
        <div className="mx-auto mb-3 text-yellow-600 dark:text-yellow-400">
          <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Account Linking Required
        </h3>
        <p className="mb-5 text-sm text-gray-700 dark:text-gray-300">
          You must link both Steam and Discord accounts before continuing.
        </p>
        {missingProvider === 'Steam' ? (
          <a
            href={linkUrl}
            className="inline-flex items-center justify-center rounded-md bg-yellow-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-700"
          >
            Link Steam Account
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void handleDiscordSignIn()}
            className="inline-flex items-center justify-center rounded-md bg-yellow-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-700"
          >
            Link Discord Account
          </button>
        )}
      </div>
    </div>
  );
}

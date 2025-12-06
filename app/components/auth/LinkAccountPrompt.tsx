'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export default function LinkAccountPrompt() {
  const { data: session, status } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [hasSteam, setHasSteam] = useState(false);
  const [hasDiscord, setHasDiscord] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      // Check if dismissed in this session
      const isDismissed = sessionStorage.getItem('linkAccountPromptDismissed');
      if (isDismissed) {
        setDismissed(true);
        return;
      }

      // Fetch user's auth providers
      fetch('/api/user/auth-providers')
        .then(res => res.json())
        .then(data => {
          setHasSteam(data.providers.includes('steam'));
          setHasDiscord(data.providers.includes('discord'));
        })
        .catch(console.error);
    }
  }, [status, session]);

  const handleDismiss = () => {
    sessionStorage.setItem('linkAccountPromptDismissed', 'true');
    setDismissed(true);
  };

  // Don't show if not authenticated, dismissed, or already has both
  if (status !== 'authenticated' || dismissed || (hasSteam && hasDiscord)) {
    return null;
  }

  const missingProvider = !hasSteam ? 'Steam' : 'Discord';
  const linkUrl = !hasSteam ? '/api/auth/steam-login' : '/api/auth/signin?provider=discord';

  return (
    <div className="fixed bottom-4 right-4 max-w-md bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-400 dark:border-yellow-600 rounded-lg shadow-lg p-4 z-50">
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-yellow-600 dark:text-yellow-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Link Your {missingProvider} Account
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            Some features require both Steam and Discord accounts to be linked. Link your {missingProvider} account now for full functionality.
          </p>
          <div className="flex gap-2">
            <a
              href={linkUrl}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              Link {missingProvider}
            </a>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-md text-sm font-medium transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

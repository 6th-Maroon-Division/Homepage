'use client';

import { useSession } from 'next-auth/react';
import { redirect, useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import Image from 'next/image';
import ThemeSettings from '@/app/components/theme/ThemeSettings';

function SettingsContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState(session?.user?.username || '');
  const [email, setEmail] = useState(session?.user?.email || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);

  useEffect(() => {
    // Check for success/error messages from account linking
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    
    if (success === 'SteamLinked') {
      setMessage('Steam account linked successfully!');
    } else if (success === 'AlreadyLinked') {
      setMessage('This Steam account is already linked to your account.');
    } else if (error === 'SteamAlreadyLinked') {
      setMessage('This Steam account is already linked to another user.');
    }
  }, [searchParams]);

  useEffect(() => {
    if (status === 'authenticated') {
      // Fetch linked providers
      fetch('/api/user/auth-providers')
        .then(res => res.json())
        .then(data => setLinkedProviders(data.providers))
        .catch(console.error);
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/');
  }

  const hasSteam = linkedProviders.includes('steam');
  const hasDiscord = linkedProviders.includes('discord');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');

    try {
      const response = await fetch('/api/user/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          email,
        }),
      });

      if (response.ok) {
        setMessage('Settings saved successfully!');
      } else {
        setMessage('Failed to save settings. Please try again.');
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      setMessage('An error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Settings</h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
            Manage your profile information and account settings
          </p>
        </header>

        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Profile Information</h2>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2"
                style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
                Avatar
              </label>
              {session?.user?.avatarUrl && (
                <Image
                  src={session.user.avatarUrl}
                  alt="User avatar"
                  width={80}
                  height={80}
                  className="rounded-full"
                />
              )}
              <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Avatar is synced from your Discord account
              </p>
            </div>

            {message && (
              <div className={`p-3 rounded-md border`} style={{
                backgroundColor: message.includes('success') ? 'var(--accent)' : 'var(--muted)',
                color: message.includes('success') ? 'var(--accent-foreground)' : 'var(--foreground)',
                borderColor: 'var(--border)'
              }}>
                {message}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 rounded-md transition-colors disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Account Information</h2>
          <div className="space-y-3 text-sm" style={{ color: 'var(--foreground)' }}>
            <div className="flex justify-between">
              <span className="font-medium">User ID:</span>
              <span>{session?.user?.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Account Created:</span>
              <span>{session?.user?.createdAt ? new Date(session.user.createdAt).toLocaleDateString('en-GB') : 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Admin Status:</span>
              <span>{session?.user?.isAdmin ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>Linked Accounts</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
            Link both Discord and Steam accounts to access all features.
          </p>
          
          <div className="space-y-3">
            {/* Discord */}
            <div className="flex items-center justify-between p-3 border rounded-md" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" style={{ color: hasDiscord ? '#5865F2' : 'var(--muted-foreground)' }}>
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <div>
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>Discord</div>
                  <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    {hasDiscord ? 'Connected' : 'Not connected'}
                  </div>
                </div>
              </div>
              {!hasDiscord && (
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a
                  href="/api/auth/signin?provider=discord"
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  Link Discord
                </a>
              )}
              {hasDiscord && (
                <span className="text-green-600 dark:text-green-400">✓ Linked</span>
              )}
            </div>

            {/* Steam */}
            <div className="flex items-center justify-between p-3 border rounded-md" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" style={{ color: hasSteam ? '#00adee' : 'var(--muted-foreground)' }}>
                  <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm8.425-11.294c-1.662 0-3.015 1.353-3.015 3.017 0 1.662 1.353 3.015 3.015 3.015 1.665 0 3.015-1.353 3.015-3.015 0-1.664-1.35-3.017-3.015-3.017zm0 4.77c-.968 0-1.754-.786-1.754-1.753 0-.966.786-1.753 1.754-1.753.966 0 1.753.787 1.753 1.753 0 .967-.787 1.753-1.753 1.753z"/>
                </svg>
                <div>
                  <div className="font-medium" style={{ color: 'var(--foreground)' }}>Steam</div>
                  <div className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    {hasSteam ? 'Connected' : 'Not connected'}
                  </div>
                </div>
              </div>
              {!hasSteam && (
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a
                  href="/api/auth/steam-login"
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  Link Steam
                </a>
              )}
              {hasSteam && (
                <span className="text-green-600 dark:text-green-400">✓ Linked</span>
              )}
            </div>
          </div>

          {(!hasSteam || !hasDiscord) && (
            <div className="mt-4 p-3 rounded-md border" style={{ backgroundColor: 'var(--accent)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--accent-foreground)' }}>
                ⚠️ Some features may be unavailable until you link both Discord and Steam accounts.
              </p>
            </div>
          )}
        </div>

        <ThemeSettings />
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    }>
      <SettingsContent />
    </Suspense>
  );
}
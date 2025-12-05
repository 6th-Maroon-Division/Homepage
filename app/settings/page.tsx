'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState } from 'react';
import Image from 'next/image';
import ThemeSettings from '@/app/components/ThemeSettings';

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [username, setUsername] = useState(session?.user?.username || '');
  const [email, setEmail] = useState(session?.user?.email || '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

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

        <ThemeSettings />
      </div>
    </main>
  );
}
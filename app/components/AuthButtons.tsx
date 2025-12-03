// app/components/AuthButtons.tsx
'use client';

import { signIn, signOut, useSession } from 'next-auth/react';

export default function AuthButtons() {
  const { data: session } = useSession();

  return (
    <div className="flex items-center space-x-4">
      {!session ? (
        <>
          <button
            onClick={() => signIn('discord')}
            className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
          >
            Sign in with Discord
          </button>
        </>
      ) : (
        <>
          <span>Welcome, {session.user?.username}</span>
          <button
            onClick={() => signOut()}
            className="bg-red-600 text-white p-2 rounded-md hover:bg-red-700"
          >
            Sign out
          </button>
        </>
      )}
    </div>
  );
}

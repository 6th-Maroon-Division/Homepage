// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn, signOut } from 'next-auth/react';

export default function TopBar() {
  const { data: session } = useSession();

  return (
    <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
      <div className="text-xl font-semibold">Your App</div>
      <div className="space-x-4">
        {!session ? (
          <button
            onClick={() => signIn('discord')}
            className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
          >
            Sign in with Discord
          </button>
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
    </div>
  );
}

// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn } from 'next-auth/react';
import UserMenu from './UserMenu';

export default function TopBar() {
  const { data: session } = useSession();

  return (
    <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
      <div className="text-xl font-semibold">6MD</div>
      <div className="space-x-4 flex items-center">
        {!session ? (
          <button
            onClick={() => signIn('discord')}
            className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
          >
            Sign in with Discord
          </button>
        ) : (
          <UserMenu />
        )}
      </div>
    </div>
  );
}

// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UserMenu from './UserMenu';

export default function TopBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/orbats', label: 'Operations' },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(href);
  };

  return (
    <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-semibold hover:text-gray-300 transition-colors">
          6MD
        </Link>
        <nav className="flex space-x-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-2 rounded-md transition-colors ${
                isActive(link.href)
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
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

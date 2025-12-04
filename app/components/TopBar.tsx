// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import UserMenu from './UserMenu';

export default function TopBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const isAdminRoute = pathname?.startsWith('/admin');

  const publicNavLinks = [
    { href: '/', label: 'Home' },
    { href: '/orbats', label: 'Operations' },
  ];

  const adminNavLinks = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/orbats', label: 'OrbATs' },
    { href: '/admin/users', label: 'Users' },
  ];

  const navLinks = isAdminRoute ? adminNavLinks : publicNavLinks;

  const isActive = (href: string) => {
    if (href === '/' || href === '/admin') {
      return pathname === href;
    }
    return pathname?.startsWith(href);
  };

  return (
    <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
      <div className="flex items-center space-x-8">
        <Link href="/" className="text-xl font-semibold hover:text-gray-300 transition-colors">
          6MD {isAdminRoute && <span className="text-sm text-blue-400 ml-2">Admin</span>}
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
        {isAdminRoute && (
          <Link
            href="/orbats"
            className="px-3 py-2 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors"
          >
            Exit Admin
          </Link>
        )}
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

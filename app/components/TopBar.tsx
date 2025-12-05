// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import UserMenu from './UserMenu';

export default function TopBar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    <div className="bg-gray-800 text-white">
      <div className="p-4 flex justify-between items-center">
        {/* Logo and Desktop Navigation */}
        <div className="flex items-center space-x-8">
          <Link href="/" className="text-xl font-semibold hover:text-gray-300 transition-colors">
            6MD {isAdminRoute && <span className="text-sm text-blue-400 ml-2">Admin</span>}
          </Link>
          <nav className="hidden md:flex space-x-4">
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

        {/* Desktop Actions */}
        <div className="hidden md:flex space-x-4 items-center">
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
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors"
            >
              Sign in with Discord
            </button>
          ) : (
            <UserMenu />
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-md hover:bg-gray-700 transition-colors"
          aria-label="Toggle menu"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {mobileMenuOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-700 px-4 py-3 space-y-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className={`block px-3 py-2 rounded-md transition-colors ${
                isActive(link.href)
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
          
          {isAdminRoute && (
            <Link
              href="/orbats"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 transition-colors"
            >
              Exit Admin
            </Link>
          )}
          
          <div className="pt-2 border-t border-gray-700">
            {!session ? (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  signIn('discord');
                }}
                className="w-full bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Sign in with Discord
              </button>
            ) : (
              <div className="space-y-2">
                <div className="px-3 py-2 text-sm text-gray-400">
                  Signed in as <span className="text-white font-medium">{session.user?.username}</span>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-md transition-colors"
                >
                  Settings
                </Link>
                {session.user?.isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 text-gray-300 hover:bg-gray-700 rounded-md transition-colors"
                  >
                    Admin Panel
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

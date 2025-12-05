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
    { href: '/admin/themes', label: 'Themes' },
  ];

  const navLinks = isAdminRoute ? adminNavLinks : publicNavLinks;

  const isActive = (href: string) => {
    if (href === '/' || href === '/admin') {
      return pathname === href;
    }
    return pathname?.startsWith(href);
  };
  return (
    <div style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}>
      <div className="p-4 flex justify-between items-center">
        {/* Logo and Desktop Navigation */}
        <div className="flex items-center space-x-8">
          <Link href="/" className="text-xl font-semibold transition-colors" style={{ color: 'var(--foreground)' }}>
            6MD {isAdminRoute && <span className="text-sm ml-2" style={{ color: 'var(--primary)' }}>Admin</span>}
          </Link>
          <nav className="hidden md:flex space-x-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 rounded-md transition-colors"
                style={{
                  backgroundColor: isActive(link.href) ? 'var(--secondary)' : 'transparent',
                  color: isActive(link.href) ? 'var(--foreground)' : 'var(--muted-foreground)',
                }}
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
              className="px-3 py-2 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--secondary)',
                color: 'var(--muted-foreground)',
              }}
            >
              Exit Admin
            </Link>
          )}
          {!session ? (
            <button
              onClick={() => signIn('discord')}
              className="p-2 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
              }}
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
          className="md:hidden p-2 rounded-md transition-colors"
          style={{ color: 'var(--foreground)' }}
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
        <div className="md:hidden px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-md transition-colors"
              style={{
                backgroundColor: isActive(link.href) ? 'var(--secondary)' : 'transparent',
                color: isActive(link.href) ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              {link.label}
            </Link>
          ))}
          
          {isAdminRoute && (
            <Link
              href="/orbats"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--secondary)',
                color: 'var(--muted-foreground)',
              }}
            >
              Exit Admin
            </Link>
          )}
          
          <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
            {!session ? (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  signIn('discord');
                }}
                className="w-full px-3 py-2 rounded-md transition-colors"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
              >
                Sign in with Discord
              </button>
            ) : (
              <div className="space-y-2">
                <div className="px-3 py-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Signed in as <span className="font-medium" style={{ color: 'var(--foreground)' }}>{session.user?.username}</span>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md transition-colors"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Settings
                </Link>
                {session.user?.isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md transition-colors"
                    style={{ color: 'var(--muted-foreground)' }}
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

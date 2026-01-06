// app/components/TopBar.tsx

'use client'; // Mark this as a Client Component

import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import UserMenu from '../auth/UserMenu';

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
  // Get page title based on pathname
  const getPageTitle = () => {
    if (pathname === '/') return null;
    if (pathname === '/orbats') return 'Operations';
    if (pathname === '/settings') return 'Settings';
    if (pathname?.startsWith('/admin/orbats')) return 'Manage OrbATs';
    if (pathname?.startsWith('/admin/users')) return 'User Management';
    if (pathname?.startsWith('/admin')) return 'Admin Dashboard';
    return null;
  };

  const pageTitle = getPageTitle();

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
                  color: isActive(link.href) ? 'var(--foreground)' : 'var(--foreground)',
                  border: '1px solid var(--border)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive(link.href)) {
                    e.currentTarget.style.backgroundColor = 'var(--button-hover)';
                    e.currentTarget.style.borderColor = 'var(--button-hover)';
                    e.currentTarget.style.color = 'var(--button-hover-foreground)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive(link.href)) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.color = 'var(--foreground)';
                  }
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Page Title (Center) */}
        {pageTitle && (
          <div className="hidden md:block absolute left-1/2 transform -translate-x-1/2">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
              {pageTitle}
            </h1>
          </div>
        )}

        {/* Desktop Actions */}
        <div className="hidden md:flex space-x-4 items-center">
          {isAdminRoute && (
            <Link
              href="/orbats"
              className="px-3 py-2 rounded-md transition-colors"
              style={{
                backgroundColor: 'var(--secondary)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--button-hover)';
                e.currentTarget.style.borderColor = 'var(--button-hover)';
                e.currentTarget.style.color = 'var(--button-hover-foreground)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--secondary)';
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.color = 'var(--foreground)';
              }}
            >
              Exit Admin
            </Link>
          )}
          {!session ? (
            <div className="flex gap-2">
              <button
                onClick={() => signIn('discord')}
                className="px-4 py-2 rounded-md transition-colors flex items-center gap-2"
                style={{
                  backgroundColor: '#5865F2',
                  color: 'white',
                }}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                Discord
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/api/auth/steam-login"
                className="px-4 py-2 rounded-md transition-colors flex items-center gap-2"
                style={{
                  backgroundColor: '#1b2838',
                  color: 'white',
                }}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
                </svg>
                Steam
              </a>
            </div>
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
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
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
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              Exit Admin
            </Link>
          )}
          
          <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
            {!session ? (
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    signIn('discord');
                  }}
                  className="w-full px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: '#5865F2',
                    color: 'white',
                  }}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  Discord
                </button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/auth/steam-login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full px-3 py-2 rounded-md transition-colors flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: '#1b2838',
                    color: 'white',
                  }}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
                  </svg>
                  Steam
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="px-3 py-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Signed in as <span className="font-medium" style={{ color: 'var(--foreground)' }}>{session.user?.username}</span>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-md transition-colors"
                  style={{ color: 'var(--foreground)', border: '1px solid var(--border)' }}
                >
                  Settings
                </Link>
                {session.user?.isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md transition-colors"
                    style={{ color: 'var(--foreground)', border: '1px solid var(--border)' }}
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

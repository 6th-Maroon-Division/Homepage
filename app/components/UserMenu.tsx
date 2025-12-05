'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export default function UserMenu() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  if (!session) {
    return null;
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 rounded-md transition-colors"
        style={{ backgroundColor: 'var(--secondary)', color: 'var(--foreground)' }}
      >
        {session.user?.avatarUrl && (
          <Image
            src={session.user.avatarUrl}
            alt="User avatar"
            width={32}
            height={32}
            className="w-8 h-8 rounded-full"
          />
        )}
        <span>{session.user?.username}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg py-1 z-50" style={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}>
          <Link
            href="/settings"
            className="block px-4 py-2 transition-colors"
            style={{ color: 'var(--foreground)' }}
            onClick={() => setIsOpen(false)}
          >
            Settings
          </Link>
          {session.user?.isAdmin && (
            <Link
              href="/admin"
              className="block px-4 py-2 transition-colors"
              style={{ color: 'var(--foreground)' }}
              onClick={() => setIsOpen(false)}
            >
              Admin Panel
            </Link>
          )}
          <hr style={{ borderColor: 'var(--border)' }} className="my-1" />
          <button
            onClick={() => {
              setIsOpen(false);
              signOut();
            }}
            className="block w-full text-left px-4 py-2 transition-colors"
            style={{ color: '#dc2626' }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

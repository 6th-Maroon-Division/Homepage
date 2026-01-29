'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ui/ToastContainer';

export default function AdminPromotionsToast() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const hasShownRef = useRef(false);

  useEffect(() => {
    if (!session?.user?.isAdmin) return;
    if (hasShownRef.current) return;

    const sessionKey = `promotionsToastShown:${session.user.id}:${session.expires}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionKey)) {
      hasShownRef.current = true;
      return;
    }

    const checkPending = async () => {
      try {
        const res = await fetch('/api/ranks/promotions/pending');
        if (!res.ok) return;
        const data = await res.json();
        const count = Array.isArray(data.proposals) ? data.proposals.length : 0;
        if (count > 0) {
          showToast(
            `You have ${count} pending promotion${count === 1 ? '' : 's'}.`,
            'info',
            7000,
            { label: 'View', url: '/admin/promotions' }
          );
        }
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sessionKey, 'true');
        }
        hasShownRef.current = true;
      } catch (error) {
        console.error('Failed to check pending promotions:', error);
      }
    };

    checkPending();
  }, [session, showToast]);

  return null;
}

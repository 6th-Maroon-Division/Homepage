'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ui/ToastContainer';
import { usePermission } from '@/app/hooks/usePermissions';
import { apiList } from '@/lib/api/client';

export default function AdminPromotionsToast() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const hasShownRef = useRef(false);
  const hasManagePromotions = usePermission('rank:manage_promotions');

  useEffect(() => {
    if (!session?.user?.id || !hasManagePromotions) return;
    if (hasShownRef.current) return;

    const sessionKey = `promotionsToastShown:${session.user.id}:${session.expires}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionKey)) {
      hasShownRef.current = true;
      return;
    }

    const controller = new AbortController();
    const checkPending = async () => {
      try {
        const proposals = await apiList<{ id: number }>('/api/ranks/promotions/pending', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const count = proposals.length;
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
        if (!controller.signal.aborted) console.error('Failed to check pending promotions:', error);
      }
    };

    void checkPending();
    return () => controller.abort();
  }, [session, showToast, hasManagePromotions]);

  return null;
}

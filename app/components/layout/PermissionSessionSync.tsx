'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ui/ToastContainer';

type UserEventPayload = {
  id?: string;
  payload?: {
    source?: string;
  };
};

export default function PermissionSessionSync() {
  const { status, data: session, update } = useSession();
  const router = useRouter();
  const { showSuccess } = useToast();
  const handledPermissionEventRef = useRef<string | null>(null);
  const showSuccessRef = useRef(showSuccess);

  useEffect(() => {
    showSuccessRef.current = showSuccess;
  }, [showSuccess]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) {
      return;
    }

    const source = new EventSource('/api/user/events');

    source.onmessage = async (event) => {
      let payload: UserEventPayload | null = null;

      try {
        payload = JSON.parse(event.data) as UserEventPayload;
      } catch {
        return;
      }

      if (payload?.payload?.source !== 'permissions.updated') {
        return;
      }

      const eventId = payload.id ?? null;
      if (eventId && handledPermissionEventRef.current === eventId) {
        return;
      }
      handledPermissionEventRef.current = eventId;

      await update();
      router.refresh();
      showSuccessRef.current('Your permissions were updated.');
    };

    return () => {
      source.close();
    };
  }, [router, session?.user?.id, status, update]);

  return null;
}
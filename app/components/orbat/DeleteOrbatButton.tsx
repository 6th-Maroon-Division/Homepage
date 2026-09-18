'use client';

import { apiRequest } from '@/lib/api/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../ui/ToastContainer';
import ConfirmModal from '../ui/ConfirmModal';

type DeleteOrbatButtonProps = {
  orbatId: number;
  hasDeletePermission?: boolean;
};

export default function DeleteOrbatButton({ orbatId, hasDeletePermission = false }: DeleteOrbatButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  if (!hasDeletePermission) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await apiRequest<null>(`/api/orbats/${orbatId}`, { method: 'DELETE' });
      showSuccess('OrbAT deleted successfully');
      router.refresh();
    } catch (error) {
      console.error('Error deleting OrbAT:', error);
      showError(error instanceof Error ? error.message : 'Error deleting OrbAT');
    } finally {
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="text-red-500 hover:text-red-400 font-medium"
      >
        Delete
      </button>
      <ConfirmModal
        isOpen={showConfirm}
        title="Delete OrbAT"
        message="Are you sure you want to delete this OrbAT? This action cannot be undone and will remove all slots and signups."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
        isDestructive={true}
        isLoading={isDeleting}
      />
    </>
  );
}

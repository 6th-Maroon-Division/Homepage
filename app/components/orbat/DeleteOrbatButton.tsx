'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../ui/ToastContainer';
import ConfirmModal from '../ui/ConfirmModal';

type DeleteOrbatButtonProps = {
  orbatId: number;
};

export default function DeleteOrbatButton({ orbatId }: DeleteOrbatButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/orbats/${orbatId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        showSuccess('OrbAT deleted successfully');
        router.refresh();
      } else {
        showError('Failed to delete OrbAT');
      }
    } catch (error) {
      console.error('Error deleting OrbAT:', error);
      showError('Error deleting OrbAT');
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

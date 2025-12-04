'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type DeleteOrbatButtonProps = {
  orbatId: number;
};

export default function DeleteOrbatButton({ orbatId }: DeleteOrbatButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/orbats/${orbatId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to delete OrbAT');
      }
    } catch (error) {
      console.error('Error deleting OrbAT:', error);
      alert('Error deleting OrbAT');
    } finally {
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  if (showConfirm) {
    return (
      <span className="inline-flex gap-2">
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-red-500 hover:text-red-400 font-medium disabled:opacity-50"
        >
          {isDeleting ? 'Deleting...' : 'Confirm'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={isDeleting}
          className="text-gray-400 hover:text-gray-300 font-medium disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="text-red-500 hover:text-red-400 font-medium"
    >
      Delete
    </button>
  );
}

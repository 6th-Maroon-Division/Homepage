'use client';

import { useState } from 'react';

type Subslot = {
  id: number;
  name: string;
  slotName: string;
  currentSignups: number;
  maxSignups: number;
};

type MoveSignupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  signupId: number;
  userName: string;
  currentSubslotName: string;
  availableSubslots: Subslot[];
  onMove: (signupId: number, targetSubslotId: number) => Promise<void>;
};

export default function MoveSignupModal({
  isOpen,
  onClose,
  signupId,
  userName,
  currentSubslotName,
  availableSubslots,
  onMove,
}: MoveSignupModalProps) {
  const [selectedSubslotId, setSelectedSubslotId] = useState<number | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleMove = async () => {
    if (!selectedSubslotId) return;

    setIsMoving(true);
    setError(null);

    try {
      await onMove(signupId, selectedSubslotId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move signup');
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full p-6 space-y-4">
        <h2 className="text-xl font-bold">Move Signup</h2>
        
        <p className="text-gray-300">
          Move <span className="font-semibold text-white">{userName}</span> from{' '}
          <span className="font-semibold text-white">{currentSubslotName}</span> to:
        </p>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-400 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {availableSubslots.length === 0 ? (
            <p className="text-gray-400 text-sm">No available subslots to move to</p>
          ) : (
            availableSubslots.map((subslot) => {
              const isFull = subslot.currentSignups >= subslot.maxSignups;
              return (
                <button
                  key={subslot.id}
                  onClick={() => setSelectedSubslotId(subslot.id)}
                  disabled={isFull}
                  className={`w-full text-left p-3 rounded-md border transition-colors ${
                    selectedSubslotId === subslot.id
                      ? 'bg-blue-600 border-blue-500'
                      : isFull
                      ? 'bg-gray-700/30 border-gray-600 opacity-50 cursor-not-allowed'
                      : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700 hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{subslot.name}</div>
                      <div className="text-sm text-gray-400">{subslot.slotName}</div>
                    </div>
                    <div className="text-sm text-gray-400">
                      {subslot.currentSignups}/{subslot.maxSignups}
                      {isFull && <span className="ml-2 text-red-400">(Full)</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={onClose}
            disabled={isMoving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={!selectedSubslotId || isMoving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-md transition-colors"
          >
            {isMoving ? 'Moving...' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import { useToast } from '@/app/components/ui/ToastContainer';
import {
  normalizeTrainingMessage,
  type TrainingRequestMessage,
} from './training-request-types';

type TrainingRequestChatProps = {
  requestId: number;
  currentUserId: number;
  isStaff: boolean;
  requestUsername: string | null;
  initialMessages: TrainingRequestMessage[];
  onMessagesChange?: (messages: TrainingRequestMessage[]) => void;
  onInvalidate?: () => void;
};

function mergeMessages(
  current: TrainingRequestMessage[],
  incoming: TrainingRequestMessage[],
): TrainingRequestMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export default function TrainingRequestChat({
  requestId,
  currentUserId,
  isStaff,
  requestUsername,
  initialMessages,
  onMessagesChange,
  onInvalidate,
}: TrainingRequestChatProps) {
  const { showError } = useToast();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);

  const updateMessages = useCallback((next: TrainingRequestMessage[]) => {
    setMessages((current) => {
      const merged = mergeMessages(current, next);
      onMessagesChange?.(merged);
      return merged;
    });
  }, [onMessagesChange]);

  const refreshMessages = useCallback(async () => {
    const response = await fetch(`/api/training-requests/${requestId}/messages`, {
      cache: 'no-store',
    });
    if (!response.ok) return;

    const payload = await response.json();
    const rawMessages = Array.isArray(payload) ? payload : payload.messages;
    if (!Array.isArray(rawMessages)) return;

    updateMessages(
      rawMessages
        .map(normalizeTrainingMessage)
        .filter((message: TrainingRequestMessage | null): message is TrainingRequestMessage => message !== null),
    );
  }, [requestId, updateMessages]);

  useEffect(() => {
    void refreshMessages();
    const source = new EventSource(`/api/training-requests/${requestId}/events`);
    // Keep a low-frequency poll even while SSE is healthy. The event bus is
    // process-local, so this also keeps chats current across multiple app
    // instances without requiring extra infrastructure.
    const polling = setInterval(() => void refreshMessages(), 10000);

    source.onopen = () => {
      setIsConnected(true);
    };
    source.onmessage = () => {
      setIsConnected(true);
      void refreshMessages();
      onInvalidate?.();
    };
    source.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      source.close();
      clearInterval(polling);
    };
  }, [onInvalidate, refreshMessages, requestId]);

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: content }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to send message');
      }

      const payload = await response.json();
      const message = normalizeTrainingMessage(payload.message ?? payload);
      if (message) updateMessages([message]);
      setDraft('');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const senderLabel = (message: TrainingRequestMessage) => {
    if (message.senderRole === 'system') return 'System';
    if (message.senderId === currentUserId) return isStaff ? 'You (Staff)' : 'You';
    if (!isStaff && message.senderRole === 'staff') return 'Staff';
    if (message.senderRole === 'user') return message.sender?.username || requestUsername || 'User';
    return message.sender?.username || 'Staff';
  };

  return (
    <section
      className="rounded-lg border overflow-hidden"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
            Chat {isStaff ? `with ${requestUsername || 'user'}` : 'with Staff'}
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Messages are saved and remain available after logout.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isConnected ? '#22c55e' : '#f59e0b' }} />
          {isConnected ? 'Live' : 'Syncing'}
        </span>
      </div>

      <div className="max-h-[32rem] min-h-72 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex min-h-60 items-center justify-center text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
            No messages yet. Start the scheduling conversation below.
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.senderId === currentUserId;
            const isSystem = message.senderRole === 'system';

            if (isSystem) {
              return (
                <div key={message.id} className="text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <span className="inline-block rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
                    {message.content}
                  </span>
                </div>
              );
            }

            return (
              <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] rounded-lg border px-3 py-2"
                  style={{
                    backgroundColor: isOwn ? 'var(--primary)' : 'var(--background)',
                    borderColor: isOwn ? 'var(--primary)' : 'var(--border)',
                    color: isOwn ? 'var(--primary-foreground)' : 'var(--foreground)',
                  }}
                >
                  <div className="mb-1 text-xs font-semibold opacity-80">{senderLabel(message)}</div>
                  <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                  <div className="mt-1 text-right text-[11px] opacity-65">
                    {new Date(message.createdAt).toLocaleString([], {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
        <label htmlFor={`training-message-${requestId}`} className="sr-only">Message</label>
        <div className="flex items-end gap-2">
          <textarea
            id={`training-message-${requestId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Write a message…"
            className="min-h-11 flex-1 resize-y rounded-md border px-3 py-2 text-sm"
            style={{
              backgroundColor: 'var(--background)',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!draft.trim() || isSending}
            className="inline-flex min-h-11 min-w-20 items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {isSending ? <LoadingSpinner size="sm" /> : 'Send'}
          </button>
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </section>
  );
}

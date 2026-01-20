'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type MessageType = 'orbat' | 'training' | 'rankup' | 'general' | 'alert';

interface Message {
  id: number;
  messageId: number;
  title: string;
  body: string;
  type: MessageType;
  actionUrl: string | null;
  isRead: boolean;
  readAt: string | null;
  deliveredAt: string;
  createdAt: string;
  createdBy: {
    id: number;
    username: string | null;
  } | null;
}

interface InboxData {
  messages: Message[];
  unreadCount: number;
  total: number;
  hasMore: boolean;
}

export default function UnifiedInbox() {
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!session?.user) return;

    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filter === 'unread') {
        queryParams.append('unread', 'true');
      }
      queryParams.append('limit', '20');

      const response = await fetch(`/api/messaging/inbox?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch messages');

      const data: InboxData = await response.json();
      setMessages(data.messages);
      setUnreadCount(data.unreadCount);
    } catch (error) {
      console.error('Error fetching messages:', error);
      showToast('Failed to load messages', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [session, filter, showToast]);

  useEffect(() => {
    if (isOpen) {
      fetchMessages();
    }
  }, [isOpen, fetchMessages]);

  // Poll for unread count when logged in
  useEffect(() => {
    if (!session?.user) return;

    const pollUnreadCount = async () => {
      try {
        const response = await fetch('/api/messaging/inbox?unread=true&limit=1');
        if (response.ok) {
          const data: InboxData = await response.json();
          setUnreadCount(data.unreadCount);
        }
      } catch (error) {
        // Silent fail for polling
        console.error('Error polling unread count:', error);
      }
    };

    // Initial fetch
    pollUnreadCount();

    // Poll every 30 seconds
    const interval = setInterval(pollUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [session]);

  const markAsRead = async (messageId: number) => {
    try {
      const response = await fetch(`/api/messaging/${messageId}/read`, {
        method: 'PUT',
      });

      if (!response.ok) throw new Error('Failed to mark as read');

      // Update local state
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId ? { ...msg, isRead: true, readAt: new Date().toISOString() } : msg
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/messaging/read-all', {
        method: 'PUT',
      });

      if (!response.ok) throw new Error('Failed to mark all as read');

      // Update local state
      setMessages(prev =>
        prev.map(msg => ({ ...msg, isRead: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
      showToast('All messages marked as read', 'success');
    } catch (error) {
      console.error('Error marking all as read:', error);
      showToast('Failed to mark messages as read', 'error');
    }
  };

  const handleMessageClick = (message: Message) => {
    if (!message.isRead) {
      markAsRead(message.id);
    }

    // If there's an actionUrl, navigate; otherwise toggle inline expansion
    if (message.actionUrl) {
      window.location.href = message.actionUrl;
      return;
    }

    setExpandedId((prev) => (prev === message.id ? null : message.id));
  };

  const getTypeIcon = (type: MessageType) => {
    switch (type) {
      case 'orbat':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        );
      case 'training':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        );
      case 'rankup':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        );
      case 'alert':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getTypeColor = (type: MessageType) => {
    switch (type) {
      case 'orbat': return '#3b82f6';
      case 'training': return '#8b5cf6';
      case 'rankup': return '#10b981';
      case 'alert': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  if (!session?.user) return null;

  return (
    <div className="relative">
      {/* Inbox Button with Badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-md transition-colors"
        style={{ color: 'var(--foreground)' }}
        aria-label="Open inbox"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 px-2 py-0.5 text-xs font-bold rounded-full"
            style={{ backgroundColor: '#ef4444', color: 'white' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Inbox Panel */}
          <div
            className="absolute right-0 mt-2 w-96 rounded-lg shadow-xl border z-50 animate-scale-in"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          >
            {/* Header */}
            <div
              className="p-4 border-b flex justify-between items-center"
              style={{ borderColor: 'var(--border)' }}
            >
              <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                Inbox {unreadCount > 0 && `(${unreadCount})`}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
                  className="text-sm px-3 py-1 rounded-md transition-colors"
                  style={{
                    backgroundColor: 'var(--secondary)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {filter === 'all' ? 'Unread' : 'All'}
                </button>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm px-3 py-1 rounded-md transition-colors"
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {/* Messages List */}
            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="p-8 flex justify-center">
                  <LoadingSpinner />
                </div>
              ) : messages.length === 0 ? (
                <div className="p-8 text-center" style={{ color: 'var(--muted-foreground)' }}>
                  {filter === 'unread' ? 'No unread messages' : 'No messages yet'}
                </div>
              ) : (
                <div>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      onClick={() => handleMessageClick(message)}
                      className="p-4 border-b transition-colors cursor-pointer"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: message.isRead ? 'transparent' : 'rgba(59, 130, 246, 0.1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--secondary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = message.isRead
                          ? 'transparent'
                          : 'rgba(59, 130, 246, 0.1)';
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div style={{ color: getTypeColor(message.type) }}>
                          {getTypeIcon(message.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-2">
                            <h4
                              className="font-semibold text-sm truncate"
                              style={{ color: 'var(--foreground)' }}
                            >
                              {message.title}
                            </h4>
                            {!message.isRead && (
                              <div
                                className="w-2 h-2 rounded-full shrink-0 mt-1"
                                style={{ backgroundColor: '#3b82f6' }}
                              />
                            )}
                          </div>
                          <p
                            className={`text-xs mt-1 ${expandedId === message.id ? '' : 'line-clamp-2'}`}
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {message.body}
                          </p>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              {new Date(message.createdAt).toLocaleString()}
                            </span>
                            {message.actionUrl && (
                              <span
                                className="text-xs font-medium"
                                style={{ color: 'var(--primary)' }}
                              >
                                View →
                              </span>
                            )}
                          </div>

                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

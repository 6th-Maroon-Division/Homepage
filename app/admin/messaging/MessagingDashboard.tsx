'use client';

import { useState } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type MessageType = 'orbat' | 'training' | 'rankup' | 'general' | 'alert';
type AudienceSelection = 'all' | 'admin';

export default function MessagingDashboard() {
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<MessageType>('general');
  const [actionUrl, setActionUrl] = useState('');
  const [audience, setAudience] = useState<AudienceSelection>('all');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !message) {
      showToast('Please fill in title and message', 'error');
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch('/api/messaging/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          message,
          type,
          actionUrl: actionUrl || null,
          audience,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send message');
      }

      const data = await response.json();
      showToast(`Message sent to ${data.recipientCount} users!`, 'success');
      
      // Reset form
      setTitle('');
      setMessage('');
      setType('general');
      setActionUrl('');
      setAudience('all');
    } catch (error) {
      console.error('Error sending message:', error);
      showToast(error instanceof Error ? error.message : 'Failed to send message', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="rounded-lg border p-6"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
        Send Message / Notification
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Message title"
            className="w-full border rounded-md px-3 py-2"
            style={{
              backgroundColor: 'var(--background)',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message content"
            rows={4}
            className="w-full border rounded-md px-3 py-2"
            style={{
              backgroundColor: 'var(--background)',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MessageType)}
              className="w-full border rounded-md px-3 py-2"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            >
              <option value="general">General</option>
              <option value="orbat">ORBAT</option>
              <option value="training">Training</option>
              <option value="rankup">Rankup</option>
              <option value="alert">Alert</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
              Audience
            </label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as AudienceSelection)}
              className="w-full border rounded-md px-3 py-2"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
            >
              <option value="all">All Users</option>
              <option value="admin">Admins Only</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
            Action URL (Optional)
          </label>
          <input
            type="text"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            placeholder="/orbats, /trainings, etc."
            className="w-full border rounded-md px-3 py-2"
            style={{
              backgroundColor: 'var(--background)',
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
            }}
          />
        </div>

        <button
          type="submit"
          disabled={isSending}
          className="px-6 py-2 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          style={{
            backgroundColor: 'var(--primary)',
            color: 'var(--primary-foreground)',
          }}
        >
          {isSending ? (
            <>
              <LoadingSpinner />
              Sending...
            </>
          ) : (
            'Send Message'
          )}
        </button>
      </form>

      <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          Message Types
        </h3>
        <ul className="space-y-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          <li><strong>General:</strong> Announcements and general information</li>
          <li><strong>ORBAT:</strong> Operation-related notifications</li>
          <li><strong>Training:</strong> Training requests and updates</li>
          <li><strong>Rankup:</strong> Rank promotion notifications</li>
          <li><strong>Alert:</strong> Important admin alerts and warnings</li>
        </ul>
      </div>
    </div>
  );
}

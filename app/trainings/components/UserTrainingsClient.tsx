'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';

type Training = {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  duration: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Category = {
  id: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

type UserTraining = {
  id: number;
  userId: number;
  trainingId: number;
  completedAt: string;
  needsRetraining: boolean;
  isHidden: boolean;
  notes: string | null;
  assignedAt: string;
  training: Training;
};

type TrainingRequest = {
  id: number;
  userId: number;
  trainingId: number;
  status: string;
  requestMessage: string | null;
  adminResponse: string | null;
  requestedAt: string;
  updatedAt: string;
  training: Training;
};

type UserTrainingsClientProps = {
  currentUserId: number;
  userTrainings: UserTraining[];
  trainingRequests: TrainingRequest[];
  allTrainings: Training[];
};

export default function UserTrainingsClient({
  currentUserId,
  userTrainings: initialUserTrainings,
  trainingRequests: initialRequests,
  allTrainings,
}: UserTrainingsClientProps) {
  const { showSuccess, showError } = useToast();
  const [userTrainings, setUserTrainings] = useState<UserTraining[]>(initialUserTrainings);
  const [trainingRequests, setTrainingRequests] = useState<TrainingRequest[]>(initialRequests);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<'my-trainings' | 'available'>('my-trainings');
  const [isSaving, setIsSaving] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [selectedTrainingId, setSelectedTrainingId] = useState<number | null>(null);

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/training-categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data.sort((a: Category, b: Category) => a.orderIndex - b.orderIndex));
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  // Refresh data
  const refreshData = async () => {
    try {
      const [trainingsRes, requestsRes] = await Promise.all([
        fetch('/api/user-trainings', { cache: 'no-store' }),
        fetch('/api/training-requests', { cache: 'no-store' }),
      ]);

      if (trainingsRes.ok) {
        const data = await trainingsRes.json();
        setUserTrainings(data);
      }

      if (requestsRes.ok) {
        const data = await requestsRes.json();
        setTrainingRequests(data);
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  // Request a training
  const handleRequestTraining = async (trainingId: number) => {
    if (!requestMessage.trim() && selectedTrainingId === trainingId) {
      showError('Please provide a message with your request');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/training-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainingId,
          requestMessage: requestMessage.trim() || null,
        }),
      });

      if (response.ok) {
        showSuccess('Training request submitted successfully');
        setRequestMessage('');
        setSelectedTrainingId(null);
        await refreshData();
      } else {
        const data = await response.json();
        showError(data.error || 'Failed to submit request');
      }
    } catch (error) {
      console.error('Error requesting training:', error);
      showError('Error submitting request');
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel a training request
  const handleCancelRequest = async (requestId: number) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showSuccess('Request cancelled successfully');
        await refreshData();
      } else {
        showError('Failed to cancel request');
      }
    } catch (error) {
      console.error('Error cancelling request:', error);
      showError('Error cancelling request');
    } finally {
      setIsSaving(false);
    }
  };

  // Get training IDs that user already has or has requested
  const userTrainingIds = new Set(userTrainings.map((ut) => ut.trainingId));
  
  // Filter training requests to only show current user's requests
  const currentUserRequests = trainingRequests.filter((tr) => tr.userId === currentUserId);
  
  const pendingRequestIds = new Set(
    currentUserRequests.filter((tr) => tr.status === 'pending').map((tr) => tr.trainingId)
  );

  // Filter available trainings
  const availableTrainings = allTrainings.filter(
    (training) => !userTrainingIds.has(training.id) && !pendingRequestIds.has(training.id)
  );

  // Group trainings by category
  const trainingsByCategory: Record<string, Training[]> = {};
  availableTrainings.forEach((training) => {
    const categoryName = training.categoryId
      ? categories.find((c) => c.id === training.categoryId)?.name || 'Other'
      : 'Other';
    if (!trainingsByCategory[categoryName]) {
      trainingsByCategory[categoryName] = [];
    }
    trainingsByCategory[categoryName].push(training);
  });

  // Create ordered list of categories with their trainings
  const orderedCategories = categories.map((cat) => ({
    name: cat.name,
    trainings: trainingsByCategory[cat.name] || [],
  }));

  // Add 'Other' category if it has trainings
  if (trainingsByCategory['Other'] && !categories.find((c) => c.name === 'Other')) {
    orderedCategories.push({
      name: 'Other',
      trainings: trainingsByCategory['Other'],
    });
  }

  return (
    <div
      className="p-6 rounded-lg border space-y-6"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
        Training Center
      </h1>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setActiveTab('my-trainings')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'my-trainings' ? 'border-b-2' : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'my-trainings' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          My Trainings ({userTrainings.length})
        </button>
        <button
          onClick={() => setActiveTab('available')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'available' ? 'border-b-2' : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'available' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          Available Trainings ({availableTrainings.length})
        </button>
      </div>

      {/* My Trainings Tab */}
      {activeTab === 'my-trainings' && (
        <div className="space-y-6">
          {/* Completed Trainings */}
          <div
            className="p-6 rounded-lg border"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              Completed Trainings
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {userTrainings.map((ut) => (
                <div
                  key={ut.id}
                  className="p-4 rounded-lg border"
                  style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                        {ut.training.name}
                      </h3>
                      {ut.training.description && (
                        <p className="text-sm mt-1 opacity-80" style={{ color: 'var(--foreground)' }}>
                          {ut.training.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ut.training.categoryId && (
                          <span
                            className="text-xs px-2 py-1 rounded"
                            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                          >
                            {categories.find((c) => c.id === ut.training.categoryId)?.name || 'Unknown'}
                          </span>
                        )}
                        {ut.training.duration && (
                          <span
                            className="text-xs px-2 py-1 rounded"
                            style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                          >
                            {ut.training.duration} minutes
                          </span>
                        )}
                        {ut.needsRetraining && (
                          <span className="text-xs px-2 py-1 rounded bg-red-500 text-white">
                            Retraining Required
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--foreground)' }}>
                        Completed: {new Date(ut.completedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-2">
                      <svg
                        className="w-8 h-8"
                        fill="var(--primary)"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
              {userTrainings.length === 0 && (
                <p className="col-span-2 text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                  No completed trainings yet
                </p>
              )}
            </div>
          </div>

          {/* Training Requests */}
          {currentUserRequests.length > 0 && (
            <div
              className="p-6 rounded-lg border"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                Training Requests
              </h2>
              <div className="space-y-3">
                {currentUserRequests.map((request) => (
                  <div
                    key={request.id}
                    className="p-4 rounded-lg border"
                    style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                            {request.training.name}
                          </h3>
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              request.status === 'pending'
                                ? 'bg-yellow-500 text-white'
                                : request.status === 'approved'
                                ? 'bg-green-500 text-white'
                                : request.status === 'rejected'
                                ? 'bg-red-500 text-white'
                                : 'bg-blue-500 text-white'
                            }`}
                          >
                            {request.status.toUpperCase()}
                          </span>
                        </div>
                        {request.requestMessage && (
                          <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                            Your message: {request.requestMessage}
                          </p>
                        )}
                        {request.adminResponse && (
                          <p className="text-sm mt-1" style={{ color: 'var(--foreground)' }}>
                            Admin response: {request.adminResponse}
                          </p>
                        )}
                        <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--foreground)' }}>
                          Requested: {new Date(request.requestedAt).toLocaleDateString()}
                        </p>
                      </div>
                      {request.status === 'pending' && (
                        <button
                          onClick={() => handleCancelRequest(request.id)}
                          disabled={isSaving}
                          className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--destructive)',
                            color: 'var(--destructive-foreground)',
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Available Trainings Tab */}
      {activeTab === 'available' && (
        <div className="space-y-6">
          {availableTrainings.length === 0 ? (
            <div
              className="p-8 rounded-lg border text-center"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <p className="opacity-60" style={{ color: 'var(--foreground)' }}>
                No available trainings at this time. You&apos;ve completed all available trainings!
              </p>
            </div>
          ) : (
            orderedCategories.map(({ name, trainings }) => (
              trainings.length > 0 && (
                <div
                  key={name}
                  className="p-6 rounded-lg border"
                  style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
                >
                  <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                    {name}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {trainings.map((training) => (
                    <div
                      key={training.id}
                      className="p-4 rounded-lg border"
                      style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
                    >
                      <h3 className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>
                        {training.name}
                      </h3>
                      {training.description && (
                        <p className="text-sm mt-1 opacity-80" style={{ color: 'var(--foreground)' }}>
                          {training.description}
                        </p>
                      )}
                      {training.duration && (
                        <p className="text-sm mt-2 opacity-70" style={{ color: 'var(--foreground)' }}>
                          Duration: {training.duration} minutes
                        </p>
                      )}
                      
                      {selectedTrainingId === training.id ? (
                        <div className="mt-4 space-y-2">
                          <textarea
                            value={requestMessage}
                            onChange={(e) => setRequestMessage(e.target.value)}
                            placeholder="Why do you want this training? (optional)"
                            rows={3}
                            className="w-full px-3 py-2 rounded border"
                            style={{
                              backgroundColor: 'var(--background)',
                              borderColor: 'var(--border)',
                              color: 'var(--foreground)',
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRequestTraining(training.id)}
                              disabled={isSaving}
                              className="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--primary-foreground)',
                              }}
                            >
                              {isSaving ? <LoadingSpinner size="sm" /> : 'Submit Request'}
                            </button>
                            <button
                              onClick={() => {
                                setSelectedTrainingId(null);
                                setRequestMessage('');
                              }}
                              className="px-4 py-2 rounded font-medium transition-colors"
                              style={{
                                backgroundColor: 'var(--secondary)',
                                color: 'var(--foreground)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedTrainingId(training.id)}
                          className="mt-4 w-full px-4 py-2 rounded font-medium transition-colors"
                          style={{
                            backgroundColor: 'var(--primary)',
                            color: 'var(--primary-foreground)',
                          }}
                        >
                          Request Training
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              )
            ))
          )}
        </div>
      )}
    </div>
  );
}

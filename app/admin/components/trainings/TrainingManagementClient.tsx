'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useToast } from '@/app/components/ui/ToastContainer';
import LoadingSpinner from '@/app/components/ui/LoadingSpinner';
import ConfirmModal from '@/app/components/ui/ConfirmModal';

type Training = {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  duration: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    userTrainings: number;
    trainingRequests: number;
  };
};

type Category = {
  id: number;
  name: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

type User = {
  id: number;
  username: string | null;
  avatarUrl: string | null;
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
  user: User;
  training: {
    id: number;
    name: string;
    description: string | null;
    categoryId: number | null;
    duration: number | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  handledByAdmin: User | null;
};

type TrainingManagementClientProps = {
  trainings: Training[];
  allRequests: TrainingRequest[];
};

export default function TrainingManagementClient({
  trainings: initialTrainings,
  allRequests: initialRequests,
}: TrainingManagementClientProps) {
  const { showSuccess, showError } = useToast();
  const [trainings, setTrainings] = useState<Training[]>(initialTrainings);
  const [allRequests, setAllRequests] = useState<TrainingRequest[]>(initialRequests);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<'trainings' | 'categories' | 'requests' | 'allRequests'>('trainings');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<number | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [requestActionModal, setRequestActionModal] = useState<{
    requestId: number;
    status: 'approved' | 'rejected';
  } | null>(null);
  const [adminMessage, setAdminMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'completed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [trainingModalOpen, setTrainingModalOpen] = useState(false);
  const [trainingSearchTerm, setTrainingSearchTerm] = useState('');
  const [trainingCategoryFilter, setTrainingCategoryFilter] = useState<'all' | string>('all');

  // Training form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    categoryId: '',
    duration: '',
    isActive: true,
  });

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories();
  }, []);

  // Fetch categories
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


  // Fetch updated data
  const refreshTrainings = async () => {
    try {
      const response = await fetch('/api/trainings');
      if (response.ok) {
        const data = await response.json();
        setTrainings(data);
      }
    } catch (error) {
      console.error('Error refreshing trainings:', error);
    }
  };

  const refreshAllRequests = async (status?: string) => {
    try {
      const query = status && status !== 'all' ? `?status=${status}` : '';
      const response = await fetch(`/api/training-requests${query}`, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setAllRequests(data);
      }
    } catch (error) {
      console.error('Error refreshing requests:', error);
    }
  };

  // Derived request collections and filters
  const pendingRequests = allRequests.filter((req) => req.status === 'pending');
  const filteredRequests = allRequests.filter((req) => {
    const matchesStatus = statusFilter === 'all' ? true : req.status === statusFilter;
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term
      ? true
      : (req.user.username || '').toLowerCase().includes(term) || req.training.name.toLowerCase().includes(term);
    return matchesStatus && matchesSearch;
  });

  const filteredTrainings = trainings.filter((training) => {
    const term = trainingSearchTerm.toLowerCase();
    const matchesSearch = !term
      ? true
      : training.name.toLowerCase().includes(term) || (training.description || '').toLowerCase().includes(term);
    const matchesCategory = trainingCategoryFilter === 'all'
      ? true
      : training.categoryId?.toString() === trainingCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Training CRUD operations
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showError('Training name is required');
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        // Update existing training
        const response = await fetch(`/api/trainings/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            categoryId: formData.categoryId ? parseInt(formData.categoryId) : null,
          }),
        });

        if (response.ok) {
          showSuccess('Training updated successfully');
          await refreshTrainings();
          resetForm();
        } else {
          showError('Failed to update training');
        }
      } else {
        // Create new training
        const response = await fetch('/api/trainings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            categoryId: formData.categoryId ? parseInt(formData.categoryId) : null,
          }),
        });

        if (response.ok) {
          showSuccess('Training created successfully');
          await refreshTrainings();
          resetForm();
        } else {
          showError('Failed to create training');
        }
      }
    } catch (error) {
      console.error('Error saving training:', error);
      showError('Error saving training');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (training: Training) => {
    setFormData({
      name: training.name,
      description: training.description || '',
      categoryId: training.categoryId?.toString() || '',
      duration: training.duration?.toString() || '',
      isActive: training.isActive,
    });
    setEditingId(training.id);
    setActiveTab('trainings');
    setTrainingModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/trainings/${deleteId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showSuccess('Training deleted successfully');
        await refreshTrainings();
        setDeleteId(null);
      } else {
        showError('Failed to delete training');
      }
    } catch (error) {
      console.error('Error deleting training:', error);
      showError('Error deleting training');
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      categoryId: '',
      duration: '',
      isActive: true,
    });
    setEditingId(null);
    setTrainingModalOpen(false);
  };

  // Handle training request actions
  const handleRequestAction = async (requestId: number, status: 'approved' | 'rejected', adminResponse?: string) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminResponse: adminResponse || null }),
      });

      if (response.ok) {
        showSuccess(`Request ${status} successfully`);
        setRequestActionModal(null);
        setAdminMessage('');
        await refreshAllRequests();
        await refreshTrainings();
      } else {
        showError(`Failed to ${status} request`);
      }
    } catch (error) {
      console.error('Error updating request:', error);
      showError('Error updating request');
    } finally {
      setIsSaving(false);
    }
  };

  // Category management functions
  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      showError('Category name is required');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/training-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName }),
      });

      if (response.ok) {
        showSuccess('Category added successfully');
        setNewCategoryName('');
        await fetchCategories();
      } else {
        const error = await response.json();
        showError(error.error || 'Failed to add category');
      }
    } catch (error) {
      console.error('Error adding category:', error);
      showError('Error adding category');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-categories/${categoryToDelete}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        showSuccess('Category deleted successfully');
        setCategoryToDelete(null);
        await fetchCategories();
        await refreshTrainings();
      } else {
        showError('Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      showError('Error deleting category');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateCategory = async (categoryId: number, name: string) => {
    if (!name.trim()) {
      showError('Category name is required');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/training-categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (response.ok) {
        showSuccess('Category updated successfully');
        setEditingCategoryId(null);
        await fetchCategories();
      } else {
        const error = await response.json();
        showError(error.error || 'Failed to update category');
      }
    } catch (error) {
      console.error('Error updating category:', error);
      showError('Error updating category');
    } finally {
      setIsSaving(false);
    }
  };

  const moveCategory = async (categoryId: number, direction: 'up' | 'down') => {
    const categoryIndex = categories.findIndex((c) => c.id === categoryId);
    if (categoryIndex === -1) return;

    const newIndex = direction === 'up' ? categoryIndex - 1 : categoryIndex + 1;
    if (newIndex < 0 || newIndex >= categories.length) return;

    setIsSaving(true);
    try {
      const category = categories[categoryIndex];
      const otherCategory = categories[newIndex];

      // Optimistically update local state
      const newCategories = [...categories];
      newCategories[categoryIndex] = { ...category, orderIndex: otherCategory.orderIndex };
      newCategories[newIndex] = { ...otherCategory, orderIndex: category.orderIndex };
      setCategories(newCategories.sort((a, b) => a.orderIndex - b.orderIndex));
      
      // Use a single API call with swap operation for atomicity
      const response = await fetch(`/api/training-categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapWithCategoryId: otherCategory.id }),
      });

      if (response.ok) {
        showSuccess('Category order updated');
      } else {
        showError('Failed to update category order');
        await fetchCategories(); // Revert on error
      }
    } catch (error) {
      console.error('Error moving category:', error);
      showError('Error moving category');
      await fetchCategories(); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="p-6 rounded-lg border space-y-6"
      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
    >
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
          Training Management
        </h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setActiveTab('trainings')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'trainings'
              ? 'border-b-2'
              : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'trainings' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          Trainings ({trainings.length})
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'categories'
              ? 'border-b-2'
              : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'categories' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          Categories ({categories.length})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'requests'
              ? 'border-b-2'
              : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'requests' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          Pending Requests ({pendingRequests.length})
        </button>
        <button
          onClick={() => setActiveTab('allRequests')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'allRequests'
              ? 'border-b-2'
              : 'opacity-60 hover:opacity-100'
          }`}
          style={{
            borderColor: activeTab === 'allRequests' ? 'var(--primary)' : 'transparent',
            color: 'var(--foreground)',
          }}
        >
          All Requests ({allRequests.length})
        </button>
      </div>

      {/* Trainings Tab */}
      {activeTab === 'trainings' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={trainingSearchTerm}
                onChange={(e) => setTrainingSearchTerm(e.target.value)}
                placeholder="Search trainings"
                className="px-3 py-2 rounded border flex-1"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
              <select
                value={trainingCategoryFilter}
                onChange={(e) => setTrainingCategoryFilter(e.target.value as typeof trainingCategoryFilter)}
                className="px-3 py-2 rounded border"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <option value="all">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id.toString()}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                resetForm();
                setActiveTab('trainings');
                setTrainingModalOpen(true);
              }}
              className="px-4 py-2 rounded font-medium transition-colors"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
              }}
            >
              New Training
            </button>
          </div>

          <div className="space-y-2">
            {filteredTrainings.map((training) => (
              <div
                key={training.id}
                className="p-4 rounded-lg border"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {training.name}
                      </h3>
                      {!training.isActive && (
                        <span
                          className="text-xs px-2 py-1 rounded"
                          style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                        >
                          Inactive
                        </span>
                      )}
                    </div>
                    {training.description && (
                      <p className="text-sm mt-1 opacity-80" style={{ color: 'var(--foreground)' }}>
                        {training.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-4 mt-2 text-sm opacity-70" style={{ color: 'var(--foreground)' }}>
                      <span>
                        Category: {training.categoryId ? (categories.find((c) => c.id === training.categoryId)?.name || 'Unknown') : 'Unassigned'}
                      </span>
                      {training.duration && <span>Duration: {training.duration}min</span>}
                    </div>
                    <div className="flex gap-4 mt-2 text-sm opacity-70" style={{ color: 'var(--foreground)' }}>
                      <span>{training._count.userTrainings} users trained</span>
                      <span>{training._count.trainingRequests} requests</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(training)}
                      className="px-3 py-1 text-sm rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: 'var(--primary-foreground)',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteId(training.id)}
                      className="px-3 py-1 text-sm rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--destructive)',
                        color: 'var(--destructive-foreground)',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredTrainings.length === 0 && (
              <p className="text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                No trainings match your filters
              </p>
            )}
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Add Category Form */}
            <div
              className="p-6 rounded-lg border"
              style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                Add New Category
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddCategory();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="w-full px-3 py-2 rounded border"
                    style={{
                      backgroundColor: 'var(--background)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                    placeholder="e.g., Combat, Medical, Aviation..."
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  {isSaving ? <LoadingSpinner size="sm" /> : 'Add Category'}
                </button>
              </form>
            </div>

            {/* Categories List */}
            <div>
              <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                Manage Categories
              </h2>
              <div className="space-y-3">
                {categories.length === 0 ? (
                  <p className="text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                    No categories yet
                  </p>
                ) : (
                  categories.map((category, index) => (
                    <div
                      key={category.id}
                      className="p-4 rounded-lg border flex items-center justify-between"
                      style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex-1">
                        {editingCategoryId === category.id ? (
                          <input
                            type="text"
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                            className="px-3 py-1 rounded border"
                            style={{
                              backgroundColor: 'var(--background)',
                              borderColor: 'var(--border)',
                              color: 'var(--foreground)',
                            }}
                            autoFocus
                          />
                        ) : (
                          <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                            {category.name}
                          </h3>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {editingCategoryId === category.id ? (
                          <>
                            <button
                              onClick={() =>
                                handleUpdateCategory(category.id, editingCategoryName)
                              }
                              disabled={isSaving}
                              className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50"
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--primary-foreground)',
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingCategoryId(null)}
                              className="px-3 py-1 text-sm rounded transition-colors"
                              style={{
                                backgroundColor: 'var(--secondary)',
                                color: 'var(--foreground)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingCategoryId(category.id);
                                setEditingCategoryName(category.name);
                              }}
                              className="px-3 py-1 text-sm rounded transition-colors"
                              style={{
                                backgroundColor: 'var(--primary)',
                                color: 'var(--primary-foreground)',
                              }}
                            >
                              Edit
                            </button>

                            {index > 0 && (
                              <button
                                onClick={() => moveCategory(category.id, 'up')}
                                disabled={isSaving}
                                className="px-2 py-1 text-sm rounded transition-colors disabled:opacity-50"
                                style={{
                                  backgroundColor: 'var(--secondary)',
                                  color: 'var(--foreground)',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                ↑
                              </button>
                            )}

                            {index < categories.length - 1 && (
                              <button
                                onClick={() => moveCategory(category.id, 'down')}
                                disabled={isSaving}
                                className="px-2 py-1 text-sm rounded transition-colors disabled:opacity-50"
                                style={{
                                  backgroundColor: 'var(--secondary)',
                                  color: 'var(--foreground)',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                ↓
                              </button>
                            )}

                            <button
                              onClick={() => setCategoryToDelete(category.id)}
                              className="px-3 py-1 text-sm rounded transition-colors"
                              style={{
                                backgroundColor: 'var(--destructive)',
                                color: 'var(--destructive-foreground)',
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Pending Training Requests
          </h2>
          <div className="space-y-4">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="p-4 rounded-lg border"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      {request.user.avatarUrl && (
                        <Image
                          src={request.user.avatarUrl}
                          alt={request.user.username || 'User'}
                          width={40}
                          height={40}
                          className="rounded-full"
                        />
                      )}
                      <div>
                        <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {request.user.username || `User ${request.userId}`}
                        </h3>
                        <p className="text-sm opacity-70" style={{ color: 'var(--foreground)' }}>
                          Requested: {request.training.name}
                        </p>
                      </div>
                    </div>
                    {request.requestMessage && (
                      <p className="mt-2 text-sm" style={{ color: 'var(--foreground)' }}>
                        Message: {request.requestMessage}
                      </p>
                    )}
                    <p className="text-xs mt-2 opacity-60" style={{ color: 'var(--foreground)' }}>
                      Requested: {new Date(request.requestedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRequestActionModal({ requestId: request.id, status: 'approved' })}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm rounded transition-colors disabled:opacity-50"
                      style={{
                        backgroundColor: 'var(--primary)',
                        color: 'var(--primary-foreground)',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setRequestActionModal({ requestId: request.id, status: 'rejected' })}
                      disabled={isSaving}
                      className="px-4 py-2 text-sm rounded transition-colors disabled:opacity-50"
                      style={{
                        backgroundColor: 'var(--destructive)',
                        color: 'var(--destructive-foreground)',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {pendingRequests.length === 0 && (
              <p className="text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                No pending requests
              </p>
            )}
          </div>
        </div>
      )}

      {/* All Requests Tab */}
      {activeTab === 'allRequests' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--foreground)' }}>
              All Training Requests
            </h2>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => {
                  const val = e.target.value as typeof statusFilter;
                  setStatusFilter(val);
                  refreshAllRequests(val);
                }}
                className="px-3 py-2 rounded border"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              >
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="completed">Completed</option>
              </select>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by user or training"
                className="px-3 py-2 rounded border flex-1"
                style={{
                  backgroundColor: 'var(--background)',
                  borderColor: 'var(--border)',
                  color: 'var(--foreground)',
                }}
              />
            </div>
          </div>

          <div className="space-y-4">
            {filteredRequests.map((request) => (
              <div
                key={request.id}
                className="p-4 rounded-lg border"
                style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
              >
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-3">
                    {request.user.avatarUrl && (
                      <Image
                        src={request.user.avatarUrl}
                        alt={request.user.username || 'User'}
                        width={40}
                        height={40}
                        className="rounded-full"
                      />
                    )}
                    <div>
                      <h3 className="font-semibold" style={{ color: 'var(--foreground)' }}>
                        {request.user.username || `User ${request.userId}`}
                      </h3>
                      <p className="text-sm opacity-70" style={{ color: 'var(--foreground)' }}>
                        Training: {request.training.name}
                      </p>
                      <p className="text-xs opacity-60" style={{ color: 'var(--foreground)' }}>
                        Requested: {new Date(request.requestedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
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
                  <p className="mt-2 text-sm" style={{ color: 'var(--foreground)' }}>
                    User message: {request.requestMessage}
                  </p>
                )}
                {request.adminResponse && (
                  <p className="mt-2 text-sm" style={{ color: 'var(--foreground)' }}>
                    Admin response: {request.adminResponse}
                  </p>
                )}
                {request.handledByAdmin && request.status !== 'pending' && (
                  <p className="mt-2 text-sm opacity-80" style={{ color: 'var(--foreground)' }}>
                    Handled by: {request.handledByAdmin.username || `Admin ${request.handledByAdmin.id}`}
                  </p>
                )}
              </div>
            ))}

            {filteredRequests.length === 0 && (
              <p className="text-center py-8 opacity-60" style={{ color: 'var(--foreground)' }}>
                No requests match your filters
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteId !== null}
        title="Delete Training"
        message="Are you sure you want to delete this training? This will also remove all user training records and requests associated with it."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        confirmLabel="Delete"
        isDestructive={true}
      />

      {/* Training Create/Edit Modal */}
      {trainingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div
            className="rounded-lg p-6 w-full max-w-xl border"
            style={{ backgroundColor: 'var(--secondary)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              {editingId ? 'Edit Training' : 'Create Training'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  Training Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 rounded border"
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
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 rounded border"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    color: 'var(--foreground)',
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Category
                  </label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                    className="w-full px-3 py-2 rounded border"
                    style={{
                      backgroundColor: 'var(--background)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                  >
                    <option value="">Select category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id.toString()}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    className="w-full px-3 py-2 rounded border"
                    style={{
                      backgroundColor: 'var(--background)',
                      borderColor: 'var(--border)',
                      color: 'var(--foreground)',
                    }}
                    min="0"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="isActive" className="text-sm" style={{ color: 'var(--foreground)' }}>
                  Active
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 rounded font-medium transition-colors"
                  style={{
                    backgroundColor: 'var(--secondary)',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded font-medium transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                  }}
                >
                  {isSaving ? <LoadingSpinner size="sm" /> : editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Category Confirmation Modal */}
      <ConfirmModal
        isOpen={categoryToDelete !== null}
        title="Delete Category"
        message="Are you sure you want to delete this category? Any trainings assigned to this category will no longer have a category assigned."
        onConfirm={handleDeleteCategory}
        onCancel={() => setCategoryToDelete(null)}
        confirmLabel="Delete"
        isDestructive={true}
      />

      {/* Request Action Modal */}
      {requestActionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div
            className="rounded-lg p-6 w-full max-w-md"
            style={{ backgroundColor: 'var(--secondary)' }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              {requestActionModal.status === 'approved' ? 'Approve Request' : 'Reject Request'}
            </h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--foreground)' }}>
              Add an optional message to send to the user:
            </p>
            <textarea
              value={adminMessage}
              onChange={(e) => setAdminMessage(e.target.value)}
              placeholder="e.g., Great work! You're approved for this training."
              className="w-full p-2 rounded border mb-4"
              style={{
                backgroundColor: 'var(--background)',
                borderColor: 'var(--border)',
                color: 'var(--foreground)',
              }}
              rows={4}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setRequestActionModal(null);
                  setAdminMessage('');
                }}
                className="px-4 py-2 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--secondary)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (requestActionModal) {
                    handleRequestAction(requestActionModal.requestId, requestActionModal.status, adminMessage.trim() || undefined);
                  }
                }}
                disabled={isSaving}
                className="px-4 py-2 rounded transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: requestActionModal.status === 'approved' ? 'var(--primary)' : 'var(--destructive)',
                  color: requestActionModal.status === 'approved' ? 'var(--primary-foreground)' : 'var(--destructive-foreground)',
                }}
              >
                {requestActionModal.status === 'approved' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

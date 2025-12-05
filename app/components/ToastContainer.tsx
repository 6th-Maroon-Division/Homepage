'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Toast, { ToastData, ToastType } from './Toast';

type ToastContextType = {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

type ToastProviderProps = {
  children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const showSuccess = useCallback((message: string, duration = 5000) => {
    showToast(message, 'success', duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration = 7000) => {
    showToast(message, 'error', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration = 6000) => {
    showToast(message, 'warning', duration);
  }, [showToast]);

  const showInfo = useCallback((message: string, duration = 5000) => {
    showToast(message, 'info', duration);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <div className="pointer-events-auto space-y-2">
          {toasts.map((toast) => (
            <Toast key={toast.id} {...toast} onClose={removeToast} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

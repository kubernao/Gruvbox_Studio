import { useCallback, useContext } from 'react';
import { ToastContext, ToastType } from '../components/ToastContainer';

export interface UseToastResult {
  addToast: (message: string, type: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
  showSuccess: (message: string, duration?: number) => string;
  showError: (message: string, duration?: number) => string;
  showInfo: (message: string, duration?: number) => string;
  showWarning: (message: string, duration?: number) => string;
}

export const useToast = (): UseToastResult => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  const { addToast, removeToast } = context;

  const showSuccess = useCallback(
    (message: string, duration?: number) => addToast(message, 'success', duration),
    [addToast]
  );
  const showError = useCallback(
    (message: string, duration?: number) => addToast(message, 'error', duration),
    [addToast]
  );
  const showInfo = useCallback(
    (message: string, duration?: number) => addToast(message, 'info', duration),
    [addToast]
  );
  const showWarning = useCallback(
    (message: string, duration?: number) => addToast(message, 'warning', duration),
    [addToast]
  );

  return { addToast, removeToast, showSuccess, showError, showInfo, showWarning };
};


import api from './api';

// Global toast function — set by ToastProvider via setupApiToast()
let _toast: ((msg: string, type?: 'error' | 'success' | 'info') => void) | null = null;

export function setupApiToast(toastFn: (msg: string, type?: 'error' | 'success' | 'info') => void) {
  _toast = toastFn;
}

// Add response interceptor that shows error toasts
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Don't toast on 401 (handled by redirect) or on retries (will toast on final failure)
    if (err.response?.status === 401) return Promise.reject(err);
    if (err.config?._retryCount && err.config._retryCount < 3) return Promise.reject(err);

    const msg = err.response?.data?.error
      || (err.response?.status ? `Server error (${err.response.status})` : 'Network error — check connection');

    if (_toast) _toast(msg, 'error');
    return Promise.reject(err);
  }
);

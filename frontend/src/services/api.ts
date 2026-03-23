import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 10000 });

// Add auth token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-retry on network errors (server temporarily down)
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config;
    // Only retry on network errors or 5xx, not on 4xx (auth, validation)
    const isNetworkError = !err.response; // connection refused, timeout, etc
    const isServerError = err.response?.status >= 500;
    const isRetryable = isNetworkError || isServerError;

    if (isRetryable && (!config._retryCount || config._retryCount < 3)) {
      config._retryCount = (config._retryCount || 0) + 1;
      const delay = config._retryCount * 2000; // 2s, 4s, 6s
      console.log(`API retry ${config._retryCount}/3 in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return api(config);
    }

    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

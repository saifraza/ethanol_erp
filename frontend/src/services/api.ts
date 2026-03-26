import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 10000 });

// Add auth token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-retry on network errors (server temporarily down during deploy)
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config;
    const isNetworkError = !err.response;
    const isServerError = err.response?.status >= 500;
    const isRetryable = isNetworkError || isServerError;

    if (isRetryable && (!config._retryCount || config._retryCount < 3)) {
      config._retryCount = (config._retryCount || 0) + 1;
      const delay = config._retryCount * 2000;
      console.log(`API retry ${config._retryCount}/3 in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return api(config);
    }

    // After all retries exhausted on 503 (deploy in progress), show reload prompt
    if (err.response?.status === 503 && config._retryCount >= 3) {
      const lastReload = sessionStorage.getItem('api-503-reload');
      const now = Date.now();
      if (!lastReload || now - parseInt(lastReload) > 60000) {
        sessionStorage.setItem('api-503-reload', String(now));
        window.location.reload();
        return new Promise(() => {}); // never resolve — page is reloading
      }
    }

    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Detect new deploy: check buildTime on health endpoint, reload if it changes
let knownBuildTime: string | null = null;
async function checkForNewDeploy() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.buildTime) {
      if (knownBuildTime && knownBuildTime !== data.buildTime) {
        console.log('New deploy detected, reloading...');
        window.location.reload();
        return;
      }
      knownBuildTime = data.buildTime;
    }
  } catch { /* ignore */ }
}
// Check on first load, then every 2 minutes
checkForNewDeploy();
setInterval(checkForNewDeploy, 2 * 60 * 1000);

// Also handle chunk load failures (old hashed JS files 404 after deploy)
window.addEventListener('error', (e) => {
  if (e.message?.includes('Loading chunk') || e.message?.includes('Failed to fetch dynamically imported module')) {
    const lastReload = sessionStorage.getItem('chunk-error-reload');
    const now = Date.now();
    if (!lastReload || now - parseInt(lastReload) > 30000) {
      sessionStorage.setItem('chunk-error-reload', String(now));
      window.location.reload();
    }
  }
});

export default api;

// api.js - Helper centralizado para llamadas al backend de SanSon
const API_BASE = import.meta.env.VITE_API_URL || '';

const getToken = () => localStorage.getItem('sanson_token');

const request = async (endpoint, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if ((res.status === 401 || res.status === 403) && endpoint !== '/api/login') {
    localStorage.removeItem('sanson_token');
    localStorage.removeItem('sanson_user');
    window.location.href = '/';
    throw new Error('Sesión expirada');
  }

  return res;
};

export const api = {
  get: (endpoint) => request(endpoint),
  post: (endpoint, body) => request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
};

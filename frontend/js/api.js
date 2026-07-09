const API_BASE_URL = 'https://symbiosis-backend.onrender.com';

/**
 * Centrally manages network fetch requests for the ISIN system.
 * Automatically injects the JWT from localStorage and handles error formatting.
 *
 * @param {string} path - The endpoint path starting with / (e.g. '/api/auth/me')
 * @param {Object} options - Standard fetch configuration options
 * @returns {Promise<any>} - Parsed JSON response body
 */
async function apiFetch(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  
  // Set headers
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  const token = localStorage.getItem('isin_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const config = {
    ...options,
    headers
  };
  
  try {
    const response = await fetch(url, config);
    let data = null;
    
    // Check if the response contains JSON data
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    }
    
    if (!response.ok) {
      const errorMessage = data && data.error ? data.error : `HTTP error! Status: ${response.status}`;
      const err = new Error(errorMessage);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    
    return data;
  } catch (error) {
    console.error(`[API Fetch Error] ${path}:`, error);
    throw error;
  }
}

// Attach it to the window object so other plain JS scripts can access it easily without modules
window.apiFetch = apiFetch;
window.API_BASE_URL = API_BASE_URL;

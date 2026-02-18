// config/api.ts


export const API_CONFIG = {
 
  BASE_URL: 'http://192.168.1.67:3000', 
  PORT: 3000,
};

// Helper function to build API URLs
export const getApiUrl = (endpoint: string) => {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
};


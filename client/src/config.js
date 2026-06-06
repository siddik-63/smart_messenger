// client/src/config.js

// When deploying the mobile app, it cannot use relative URLs (like '/api/...')
// because the mobile app runs locally on 'http://localhost' and has no Node.js backend.
// Therefore, we MUST provide the ABSOLUTE URL to the backend server.

// IF RUNNING LOCALLY: Set VITE_API_URL in your .env file or rely on the fallback.
// IF RUNNING IN PRODUCTION: Set VITE_API_URL to your live backend URL (e.g., https://my-backend.onrender.com)

export const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`;


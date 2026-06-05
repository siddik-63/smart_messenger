// client/src/config.js

// When deploying the mobile app, it cannot use relative URLs (like '/api/...')
// because the mobile app runs locally on 'http://localhost' and has no Node.js backend.
// Therefore, we MUST provide the ABSOLUTE URL to the backend server.

// IF RUNNING LOCALLY: Find your computer's local IP (e.g., 192.168.x.x) and replace it below.
// IF RUNNING IN PRODUCTION: Replace it with your live backend URL (e.g., https://my-backend.onrender.com)

export const API_BASE_URL = 'http://192.168.1.100:5000'; // <-- UPDATE THIS

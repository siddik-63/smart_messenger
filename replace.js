const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'client', 'src', 'App.jsx');
let content = fs.readFileSync(appPath, 'utf8');

// Replace fetch('/api/...
content = content.replace(/fetch\('\/api\//g, "fetch(API_BASE_URL + '/api/");

// Replace fetch(`/api/...
content = content.replace(/fetch\(`\/api\//g, "fetch(API_BASE_URL + `/api/");

// Add import if not exists
if (!content.includes('import { API_BASE_URL }')) {
    content = content.replace("import React,", "import { API_BASE_URL } from './config';\nimport React,");
}

fs.writeFileSync(appPath, content, 'utf8');
console.log('App.jsx updated!');

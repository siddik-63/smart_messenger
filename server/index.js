require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// Health Check Endpoint (Render ping)
app.get('/', (req, res) => {
    res.json({ status: "healthy", service: "smart-messenger-backend" });
});

// Mount modular API routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Create HTTP and Socket.io Servers
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Attach socket handlers
require('./socket/socketHandler')(io);

// Start Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Modular Full-stack Server running on http://0.0.0.0:${PORT}`);
});

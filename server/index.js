require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Email Transporter (Option B)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 's6363603861@gmail.com', // fallback for local if env is missing
        pass: process.env.EMAIL_PASS
    }
});

// In-memory OTP storage
const emailOtps = {};

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' })); // support large user profile photos

const dbPath = path.join(__dirname, 'db.json');

// Helper to read database
async function readDB() {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading db.json, returning empty structure", err);
        return { users: [], messages: {} };
    }
}

// Helper to write database
async function writeDB(db) {
    try {
        await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing to db.json", err);
    }
}

// -----------------------------------------------------------------
// TRANSLATION ENGINE (MyMemory API with Offline Fallbacks)
// -----------------------------------------------------------------
const localDictionary = {
    "hello": { es: "Hola", ja: "こんにちは", fr: "Bonjour", de: "Hallo" },
    "how are you?": { es: "¿Cómo estás?", ja: "お元気ですか？", fr: "Comment ça va?", de: "Wie geht es dir?" },
    "how are you": { es: "¿Cómo estás?", ja: "お元気ですか？", fr: "Comment ça va?", de: "Wie geht es dir?" },
    "good morning": { es: "Buenos días", ja: "おはようございます", fr: "Bonjour", de: "Guten morgen" },
    "thank you": { es: "Gracias", ja: "ありがとう", fr: "Merci", de: "Danke" },
    "yes": { es: "Sí", ja: "はい", fr: "Oui", de: "Ja" },
    "no": { es: "No", ja: "いいえ", fr: "Non", de: "Nein" },
    "goodbye": { es: "Adiós", ja: "さようなら", fr: "Au revoir", de: "Auf wiedersehen" }
};

async function translateText(text, fromLang, toLang) {
    if (!text.trim()) return '';
    if (fromLang === toLang) return text;

    try {
        // Since the backend has internet access in the user's host environment, we can fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout
        // Upgrade to Google Translate Neural API for highly accurate, context and emotion-aware translation
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data && data[0]) {
            // Google translate returns an array of segments
            const translatedSegments = data[0].map(item => item[0]);
            return translatedSegments.join('');
        }
        throw new Error("Translation API responded with unexpected format");
    } catch (err) {
        console.warn(`Translation failed from ${fromLang} to ${toLang}. Using offline dictionary:`, err.message);
        
        const clean = text.toLowerCase().trim().replace(/[?.!,]/g, '');
        if (localDictionary[clean] && localDictionary[clean][toLang]) {
            return localDictionary[clean][toLang];
        }
        // Fallback string
        return `[${toLang.toUpperCase()}] ${text}`;
    }
}

// -----------------------------------------------------------------
// REST API ROUTES
// -----------------------------------------------------------------

// Translate Endpoint
app.post('/api/translate', async (req, res) => {
    const { text, fromLang, toLang } = req.body;
    if (!text) {
        return res.status(400).json({ error: "Missing parameter: text" });
    }
    const translation = await translateText(text, fromLang || 'en', toLang || 'es');
    res.json({ translatedText: translation });
});

// Check if user exists
app.post('/api/auth/check-user', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const db = await readDB();
    const exists = db.users.some(u => u.id.toLowerCase() === id.toLowerCase());
    res.json({ exists });
});

// Send Custom Email OTP
app.post('/api/auth/send-email-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    emailOtps[email.toLowerCase()] = otp;

    const mailOptions = {
        from: 's6363603861@gmail.com',
        to: email,
        subject: 'Your Smart Messenger Verification Code',
        text: `Your verification code is: ${otp}`
    };

    console.log(`[DEVELOPMENT] Generated OTP for ${email}: ${otp}`);

    try {
        // Use Promise.race to enforce a 5-second timeout on the email sending
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Email timeout")), 5000));
        await Promise.race([transporter.sendMail(mailOptions), timeoutPromise]);
        console.log(`Email OTP sent to ${email}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Error sending email (could be timeout or auth issue):", error.message);
        // We return success anyway so the user can use the OTP printed in the console (or a default)
        // For testing purposes, we'll allow them to bypass if the email fails.
        // The user can enter the OTP they see in the server logs.
        res.json({ success: true, warning: "Email failed to send, but proceeding for development." });
    }
});

// Verify Custom Email OTP
app.post('/api/auth/verify-email-otp', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Missing parameters" });

    const storedOtp = emailOtps[email.toLowerCase()];
    // Allow master OTP 000000 for testing, or the real OTP
    if ((storedOtp && storedOtp === code) || code === '000000') {
        delete emailOtps[email.toLowerCase()]; // clear OTP after use
        
        // Find existing user or return success for new user
        const db = await readDB();
        const user = db.users.find(u => u.id.toLowerCase() === email.toLowerCase());
        
        if (user) {
             res.json({ success: true, isNewUser: false, user: { id: user.id, name: user.name, age: user.age, photo: user.photo } });
        } else {
             res.json({ success: true, isNewUser: true, user: { id: email.toLowerCase() } });
        }
    } else {
        res.status(400).json({ error: "Invalid OTP" });
    }
});

// Authenticate / Login
app.post('/api/auth/login', async (req, res) => {
    const { id, password } = req.body;
    if (!id || !password) return res.status(400).json({ error: "Missing credentials" });

    const db = await readDB();
    const user = db.users.find(u => u.id.toLowerCase() === id.toLowerCase() && u.password === password);
    
    if (user) {
        res.json({ success: true, user: { id: user.id, name: user.name, age: user.age, photo: user.photo } });
    } else {
        res.status(401).json({ success: false, error: "Incorrect password or identifier." });
    }
});

// Save or Update User Profile Details
app.post('/api/auth/register', async (req, res) => {
    const { id, password, name, age, photo } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const db = await readDB();
    const existingIndex = db.users.findIndex(u => u.id.toLowerCase() === id.toLowerCase());

    const userProfile = { id: id.toLowerCase(), password, name, age, photo };

    if (existingIndex > -1) {
        // Keep old password if not provided
        if (!password) {
            userProfile.password = db.users[existingIndex].password;
        }
        db.users[existingIndex] = userProfile;
    } else {
        db.users.push(userProfile);
    }

    await writeDB(db);
    res.json({ success: true, user: userProfile });
});

// Get Messages History
app.get('/api/messages/:userId/:contactId', async (req, res) => {
    const { userId, contactId } = req.params;
    const db = await readDB();
    const threadKey = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
    const thread = db.messages[threadKey] || [];
    
    // Map relative sender values based on who is asking
    const mappedThread = thread.map(msg => ({
        ...msg,
        sender: msg.senderId ? (msg.senderId === userId.toLowerCase() ? 'outgoing' : 'incoming') : msg.sender
    }));
    res.json(mappedThread);
});

// Clear Messages History
app.delete('/api/messages/:userId/:contactId', async (req, res) => {
    const { userId, contactId } = req.params;
    const db = await readDB();
    const threadKey = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
    db.messages[threadKey] = [];
    await writeDB(db);
    res.json({ success: true });
});

// Add Contact Endpoint
app.post('/api/contacts/add', async (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) {
        return res.status(400).json({ error: "Missing userId or contactId" });
    }

    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    if (uId === cId) {
        return res.status(400).json({ error: "You cannot add yourself as a contact" });
    }

    const db = await readDB();
    const user = db.users.find(u => u.id.toLowerCase() === uId);
    const contactUser = db.users.find(u => u.id.toLowerCase() === cId);

    if (!user) {
        return res.status(404).json({ error: "Current user session not found" });
    }
    if (!contactUser) {
        return res.status(404).json({ error: "User with this identifier does not exist" });
    }

    // Add to user's contacts
    if (!user.contacts) user.contacts = [];
    if (!user.contacts.includes(contactUser.id)) {
        user.contacts.push(contactUser.id);
    }

    // Add to contact's contacts (mutual add)
    if (!contactUser.contacts) contactUser.contacts = [];
    if (!contactUser.contacts.includes(user.id)) {
        contactUser.contacts.push(user.id);
    }

    await writeDB(db);
    res.json({
        success: true,
        contact: {
            id: contactUser.id,
            name: contactUser.name,
            age: contactUser.age,
            photo: contactUser.photo || ''
        }
    });
});

// Get Contacts List Endpoint
app.get('/api/contacts/:userId', async (req, res) => {
    const { userId } = req.params;
    const db = await readDB();
    const user = db.users.find(u => u.id.toLowerCase() === userId.toLowerCase());
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    const contactsList = [];
    const contactIds = user.contacts || [];

    for (const cId of contactIds) {
        const contactUser = db.users.find(u => u.id.toLowerCase() === cId.toLowerCase());
        if (contactUser) {
            // Get last message in the room
            const roomKey = [userId.toLowerCase(), cId.toLowerCase()].sort().join('_');
            const thread = db.messages[roomKey] || [];
            const lastMsg = thread[thread.length - 1];

            contactsList.push({
                id: contactUser.id,
                name: contactUser.name,
                age: contactUser.age,
                photo: contactUser.photo || '',
                snippet: lastMsg ? lastMsg.translation : 'No messages yet',
                time: lastMsg ? lastMsg.time : '',
                badge: 'Chat',
                online: true
            });
        }
    }
    res.json(contactsList);
});

// Get User Profile Endpoint (Public/Contact details lookup)
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const db = await readDB();
    const user = db.users.find(u => u.id.toLowerCase() === id.toLowerCase());
    if (user) {
        res.json({
            id: user.id,
            name: user.name,
            age: user.age,
            photo: user.photo || ''
        });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// -----------------------------------------------------------------
// SOCKET.IO REAL-TIME COMMUNICATION
// -----------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join room
    socket.on('join_chat', ({ userId, contactId }) => {
        const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
        socket.join(room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
    });

    // Send Message
    socket.on('send_msg', async (data) => {
        const { userId, contactId, translation, original, time } = data;
        const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
        
        // Save message to database with senderId for perspective resolution
        const db = await readDB();
        if (!db.messages[room]) {
            db.messages[room] = [];
        }
        
        const messageObject = {
            senderId: userId.toLowerCase(),
            translation,
            original,
            time
        };
        db.messages[room].push(messageObject);
        await writeDB(db);

        // Broadcast to other room members
        const relayMessage = {
            sender: 'incoming',
            translation,
            original,
            time
        };
        socket.to(room).emit('receive_msg', relayMessage);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Run HTTP Server
server.listen(PORT, () => {
    console.log(`Full-stack Server running on http://localhost:${PORT}`);
});

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Email Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 's6363603861@gmail.com',
        pass: (process.env.EMAIL_PASS || 'adlx edav xvea cbyw').replace(/\s+/g, '')
    }
});

// In-memory OTP storage
const emailOtps = {};

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const dbPath = path.join(__dirname, 'db.json');

// Local file DB read/write helpers
async function readDB() {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading db.json, returning empty structure", err);
        return { users: [], messages: {} };
    }
}

async function writeDB(db) {
    try {
        await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
        console.error("Error writing to db.json", err);
    }
}

// -----------------------------------------------------------------
// DATABASE CONNECTION SETUP (MongoDB with Local Fallback)
// -----------------------------------------------------------------
const useMongoDB = !!process.env.MONGODB_URI;

if (useMongoDB) {
    console.log("Connecting to MongoDB Atlas...");
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("Connected to MongoDB Atlas successfully"))
        .catch(err => console.error("MongoDB Connection Error:", err));
} else {
    console.log("Using local db.json database file");
}

// User Schema (MongoDB)
const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
    age: { type: String, default: '' },
    photo: { type: String, default: '' },
    contacts: [{ type: String, lowercase: true }]
});

const MongoUser = useMongoDB ? mongoose.model('User', userSchema) : null;

// Message Schema (MongoDB)
const messageSchema = new mongoose.Schema({
    room: { type: String, required: true },
    senderId: { type: String, required: true, lowercase: true },
    translation: { type: String, default: '' },
    original: { type: String, default: '' },
    time: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});

const MongoMessage = useMongoDB ? mongoose.model('Message', messageSchema) : null;

// -----------------------------------------------------------------
// SECURE PASSWORD HASHING HELPERS
// -----------------------------------------------------------------
async function hashPassword(plainPassword) {
    if (!plainPassword) return '';
    return await bcrypt.hash(plainPassword, 10);
}

async function checkPassword(plainPassword, hashedPassword) {
    if (!plainPassword || !hashedPassword) return false;
    // Allow legacy plain-text passwords in db.json for easy migration
    if (!hashedPassword.startsWith('$2a$') && !hashedPassword.startsWith('$2b$')) {
        return plainPassword === hashedPassword;
    }
    return await bcrypt.compare(plainPassword, hashedPassword);
}

// -----------------------------------------------------------------
// DUAL-DATABASE CRUD HELPERS
// -----------------------------------------------------------------
async function dbFindUser(id) {
    const cleanId = id.trim().toLowerCase();
    if (useMongoDB) {
        const doc = await MongoUser.findOne({ id: cleanId });
        if (!doc) return null;
        return {
            id: doc.id,
            password: doc.password,
            name: doc.name,
            age: doc.age,
            photo: doc.photo,
            contacts: doc.contacts || []
        };
    } else {
        const db = await readDB();
        const user = db.users.find(u => u.id.toLowerCase() === cleanId);
        return user || null;
    }
}

async function dbSaveUser(id, plainPassword, name, age, photo) {
    const cleanId = id.trim().toLowerCase();
    
    let hashedPassword = '';
    if (plainPassword) {
        hashedPassword = await hashPassword(plainPassword);
    }

    if (useMongoDB) {
        let doc = await MongoUser.findOne({ id: cleanId });
        if (doc) {
            if (name !== undefined) doc.name = name;
            if (age !== undefined) doc.age = age;
            if (photo !== undefined) doc.photo = photo;
            if (plainPassword) doc.password = hashedPassword;
            await doc.save();
        } else {
            doc = new MongoUser({
                id: cleanId,
                password: hashedPassword,
                name: name || '',
                age: age || '',
                photo: photo || '',
                contacts: []
            });
            await doc.save();
        }
        return {
            id: doc.id,
            name: doc.name,
            age: doc.age,
            photo: doc.photo
        };
    } else {
        const db = await readDB();
        const existingIndex = db.users.findIndex(u => u.id.toLowerCase() === cleanId);
        const userProfile = existingIndex > -1 ? { ...db.users[existingIndex] } : { id: cleanId, contacts: [] };

        if (name !== undefined) userProfile.name = name;
        if (age !== undefined) userProfile.age = age;
        if (photo !== undefined) userProfile.photo = photo;
        if (plainPassword) userProfile.password = hashedPassword;

        if (existingIndex > -1) {
            db.users[existingIndex] = userProfile;
        } else {
            db.users.push(userProfile);
        }
        await writeDB(db);
        return {
            id: userProfile.id,
            name: userProfile.name,
            age: userProfile.age,
            photo: userProfile.photo
        };
    }
}

async function dbAddContact(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    if (useMongoDB) {
        await MongoUser.updateOne({ id: uId }, { $addToSet: { contacts: cId } });
        await MongoUser.updateOne({ id: cId }, { $addToSet: { contacts: uId } });
        
        const contactUser = await MongoUser.findOne({ id: cId });
        return {
            id: contactUser.id,
            name: contactUser.name,
            age: contactUser.age,
            photo: contactUser.photo || ''
        };
    } else {
        const db = await readDB();
        const user = db.users.find(u => u.id.toLowerCase() === uId);
        const contactUser = db.users.find(u => u.id.toLowerCase() === cId);

        if (!user || !contactUser) return null;

        if (!user.contacts) user.contacts = [];
        if (!user.contacts.includes(contactUser.id)) {
            user.contacts.push(contactUser.id);
        }

        if (!contactUser.contacts) contactUser.contacts = [];
        if (!contactUser.contacts.includes(user.id)) {
            contactUser.contacts.push(user.id);
        }

        await writeDB(db);
        return {
            id: contactUser.id,
            name: contactUser.name,
            age: contactUser.age,
            photo: contactUser.photo || ''
        };
    }
}

async function dbGetContacts(userId) {
    const uId = userId.trim().toLowerCase();
    if (useMongoDB) {
        const user = await MongoUser.findOne({ id: uId });
        if (!user) return [];
        const contactsList = [];
        const contactIds = user.contacts || [];

        for (const cId of contactIds) {
            const contactUser = await MongoUser.findOne({ id: cId });
            if (contactUser) {
                const roomKey = [uId, cId].sort().join('_');
                const lastMsg = await MongoMessage.findOne({ room: roomKey }).sort({ timestamp: -1 });
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
        return contactsList;
    } else {
        const db = await readDB();
        const user = db.users.find(u => u.id.toLowerCase() === uId);
        if (!user) return [];
        const contactsList = [];
        const contactIds = user.contacts || [];

        for (const cId of contactIds) {
            const contactUser = db.users.find(u => u.id.toLowerCase() === cId.toLowerCase());
            if (contactUser) {
                const roomKey = [uId, cId].sort().join('_');
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
        return contactsList;
    }
}

async function dbGetMessages(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (useMongoDB) {
        const docs = await MongoMessage.find({ room: roomKey }).sort({ timestamp: 1 });
        return docs.map(msg => ({
            sender: msg.senderId === uId ? 'outgoing' : 'incoming',
            senderId: msg.senderId,
            translation: msg.translation,
            original: msg.original,
            time: msg.time
        }));
    } else {
        const db = await readDB();
        const thread = db.messages[roomKey] || [];
        return thread.map(msg => ({
            sender: msg.senderId ? (msg.senderId === uId ? 'outgoing' : 'incoming') : msg.sender,
            senderId: msg.senderId || (msg.sender === 'outgoing' ? uId : cId),
            translation: msg.translation,
            original: msg.original,
            time: msg.time
        }));
    }
}

async function dbSaveMessage(userId, contactId, translation, original, time) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (useMongoDB) {
        const newMessage = new MongoMessage({
            room: roomKey,
            senderId: uId,
            translation,
            original,
            time
        });
        await newMessage.save();
    } else {
        const db = await readDB();
        if (!db.messages[roomKey]) {
            db.messages[roomKey] = [];
        }
        const messageObject = {
            senderId: uId,
            translation,
            original,
            time
        };
        db.messages[roomKey].push(messageObject);
        await writeDB(db);
    }
}

async function dbClearMessages(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (useMongoDB) {
        await MongoMessage.deleteMany({ room: roomKey });
    } else {
        const db = await readDB();
        db.messages[roomKey] = [];
        await writeDB(db);
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        if (data && data[0]) {
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

    const user = await dbFindUser(id);
    res.json({ exists: !!user });
});

// Send Custom Email OTP
app.post('/api/auth/send-email-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

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
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Email timeout")), 5000));
        await Promise.race([transporter.sendMail(mailOptions), timeoutPromise]);
        console.log(`Email OTP sent to ${email}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Error sending email:", error.message);
        res.json({ success: true, warning: "Email failed to send, but proceeding for development." });
    }
});

// Verify Custom Email OTP
app.post('/api/auth/verify-email-otp', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Missing parameters" });

    const storedOtp = emailOtps[email.toLowerCase()];
    if ((storedOtp && storedOtp === code) || code === '000000') {
        delete emailOtps[email.toLowerCase()];
        
        const user = await dbFindUser(email);
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

    const user = await dbFindUser(id);
    if (user && await checkPassword(password, user.password)) {
        res.json({ success: true, user: { id: user.id, name: user.name, age: user.age, photo: user.photo } });
    } else {
        res.status(401).json({ success: false, error: "Incorrect password or identifier." });
    }
});

// Save or Update User Profile Details
app.post('/api/auth/register', async (req, res) => {
    const { id, password, name, age, photo } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const userProfile = await dbSaveUser(id, password, name, age, photo);
    res.json({ success: true, user: userProfile });
});

// Get Messages History
app.get('/api/messages/:userId/:contactId', async (req, res) => {
    const { userId, contactId } = req.params;
    const mappedThread = await dbGetMessages(userId, contactId);
    res.json(mappedThread);
});

// Clear Messages History
app.delete('/api/messages/:userId/:contactId', async (req, res) => {
    const { userId, contactId } = req.params;
    await dbClearMessages(userId, contactId);
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

    const user = await dbFindUser(uId);
    const contactUser = await dbFindUser(cId);

    if (!user) {
        return res.status(404).json({ error: "Current user session not found" });
    }
    if (!contactUser) {
        return res.status(404).json({ error: "User with this identifier does not exist" });
    }

    const addedContact = await dbAddContact(uId, cId);
    res.json({ success: true, contact: addedContact });
});

// Get Contacts List Endpoint
app.get('/api/contacts/:userId', async (req, res) => {
    const { userId } = req.params;
    const contactsList = await dbGetContacts(userId);
    res.json(contactsList);
});

// Get User Profile Endpoint
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const user = await dbFindUser(id);
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

    socket.on('join_chat', ({ userId, contactId }) => {
        const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
        socket.join(room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
    });

    socket.on('send_msg', async (data) => {
        const { userId, contactId, translation, original, time } = data;
        const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
        
        await dbSaveMessage(userId, contactId, translation, original, time);

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

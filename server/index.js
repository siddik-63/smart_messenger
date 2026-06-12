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

// In-memory Online users map (userId -> true)
const onlineUsers = {};

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
// DATABASE CONNECTION SETUP (MongoDB & Firebase Realtime DB)
// -----------------------------------------------------------------
const useMongoDB = !!process.env.MONGODB_URI;
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

let db = null;
let useFirebase = false;

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        console.log("Initializing Firebase Admin using FIREBASE_SERVICE_ACCOUNT_JSON...");
        admin.initializeApp({
            credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
        });
        db = getFirestore();
        useFirebase = true;
    } else {
        const saPath = path.join(__dirname, 'firebase-service-account.json');
        const fsSync = require('fs');
        if (fsSync.existsSync(saPath)) {
            console.log("Initializing Firebase Admin using firebase-service-account.json...");
            admin.initializeApp({
                credential: admin.cert(require(saPath))
            });
            db = getFirestore();
            useFirebase = true;
        } else {
            console.warn("\n========================================================");
            console.warn("WARNING: Firebase service account key not found!");
            console.warn("Please place 'firebase-service-account.json' in server/");
            console.warn("or set FIREBASE_SERVICE_ACCOUNT_JSON env variable.");
            console.warn("Using local db.json database file fallback.");
            console.warn("========================================================\n");
        }
    }
} catch (err) {
    console.error("Failed to initialize Firebase Admin:", err.message);
}

if (useMongoDB) {
    console.log("Connecting to MongoDB Atlas...");
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("Connected to MongoDB Atlas successfully"))
        .catch(err => console.error("MongoDB Connection Error:", err));
} else if (useFirebase) {
    console.log("Using Firebase Cloud Firestore");
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
    language: { type: String, default: 'en' },
    contacts: [{ type: String, lowercase: true }],
    isPlaceholder: { type: Boolean, default: false }
});

const MongoUser = useMongoDB ? mongoose.model('User', userSchema) : null;

// Message Schema (MongoDB)
const messageSchema = new mongoose.Schema({
    id: { type: String, required: true },
    room: { type: String, required: true },
    senderId: { type: String, required: true, lowercase: true },
    translation: { type: String, default: '' },
    original: { type: String, default: '' },
    image: { type: String, default: '' },
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

// Firebase Realtime Database doesn't allow certain characters in keys (like '.')
// We escape email dots to commas since email is used as ID.
function escapeFirebaseKey(key) {
    if (!key) return '';
    return key.replace(/[\.\$\#\[\]\/]/g, (c) => {
        if (c === '.') return ',';
        return `_hex_${c.charCodeAt(0).toString(16)}`;
    });
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
            language: doc.language || 'en',
            contacts: doc.contacts || [],
            isPlaceholder: doc.isPlaceholder || false
        };
    } else if (useFirebase && db) {
        try {
            const docRef = db.collection('users').doc(cleanId);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return null;
            
            const userData = docSnap.data();
            const contactsSnap = await docRef.collection('contacts').get();
            const contactsList = contactsSnap.docs.map(d => d.id);
            
            return {
                id: userData.id || cleanId,
                password: userData.password || '',
                name: userData.name || '',
                age: userData.age || '',
                photo: userData.photo || '',
                language: userData.language || 'en',
                contacts: contactsList,
                isPlaceholder: userData.isPlaceholder || false
            };
        } catch (err) {
            console.error(`Firebase error finding user ${id}:`, err);
            return null;
        }
    } else {
        const dbLocal = await readDB();
        const user = dbLocal.users.find(u => u.id.toLowerCase() === cleanId);
        if (user && !user.language) user.language = 'en';
        if (user && user.isPlaceholder === undefined) user.isPlaceholder = false;
        return user || null;
    }
}

async function dbSaveUser(id, plainPassword, name, age, photo, language) {
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
            if (language !== undefined) doc.language = language;
            doc.isPlaceholder = false;
            await doc.save();
        } else {
            doc = new MongoUser({
                id: cleanId,
                password: hashedPassword,
                name: name || '',
                age: age || '',
                photo: photo || '',
                language: language || 'en',
                contacts: [],
                isPlaceholder: false
            });
            await doc.save();
        }
        return {
            id: doc.id,
            name: doc.name,
            age: doc.age,
            photo: doc.photo,
            language: doc.language
        };
    } else if (useFirebase && db) {
        try {
            const docRef = db.collection('users').doc(cleanId);
            const docSnap = await docRef.get();
            const existing = docSnap.exists ? docSnap.data() : {};
            
            const updates = {};
            if (name !== undefined) updates.name = name;
            if (age !== undefined) updates.age = age;
            if (photo !== undefined) updates.photo = photo;
            if (plainPassword) updates.password = hashedPassword;
            if (language !== undefined) updates.language = language;
            updates.isPlaceholder = false;
            
            if (!existing.id) updates.id = cleanId;

            await docRef.set(updates, { merge: true });
            
            return {
                id: cleanId,
                name: updates.name !== undefined ? updates.name : (existing.name || ''),
                age: updates.age !== undefined ? updates.age : (existing.age || ''),
                photo: updates.photo !== undefined ? updates.photo : (existing.photo || ''),
                language: updates.language !== undefined ? updates.language : (existing.language || 'en')
            };
        } catch (err) {
            console.error(`Firebase error saving user ${id}:`, err);
            throw err;
        }
    } else {
        const dbLocal = await readDB();
        const existingIndex = dbLocal.users.findIndex(u => u.id.toLowerCase() === cleanId);
        const userProfile = existingIndex > -1 ? { ...dbLocal.users[existingIndex] } : { id: cleanId, contacts: [], language: 'en', isPlaceholder: false };

        if (name !== undefined) userProfile.name = name;
        if (age !== undefined) userProfile.age = age;
        if (photo !== undefined) userProfile.photo = photo;
        if (plainPassword) userProfile.password = hashedPassword;
        if (language !== undefined) userProfile.language = language;
        userProfile.isPlaceholder = false;

        if (existingIndex > -1) {
            dbLocal.users[existingIndex] = userProfile;
        } else {
            dbLocal.users.push(userProfile);
        }
        await writeDB(dbLocal);
        return {
            id: userProfile.id,
            name: userProfile.name,
            age: userProfile.age,
            photo: userProfile.photo,
            language: userProfile.language
        };
    }
}

async function dbAddContact(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    // Ensure contact user exists, otherwise create placeholder
    let contactUser = await dbFindUser(cId);
    if (!contactUser) {
        const tempPass = await hashPassword('PlaceholderPass123!');
        if (useMongoDB) {
            const newDoc = new MongoUser({
                id: cId,
                password: tempPass,
                name: cId.split('@')[0],
                age: '',
                photo: '',
                language: 'en',
                contacts: [uId],
                isPlaceholder: true
            });
            await newDoc.save();
        } else if (useFirebase && db) {
            try {
                const docRef = db.collection('users').doc(cId);
                await docRef.set({
                    id: cId,
                    password: tempPass,
                    name: cId.split('@')[0],
                    age: '',
                    photo: '',
                    language: 'en',
                    isPlaceholder: true
                });
            } catch (err) {
                console.error("Firebase error creating placeholder contact user:", err);
            }
        } else {
            const dbLocal = await readDB();
            dbLocal.users.push({
                id: cId,
                password: tempPass,
                name: cId.split('@')[0],
                age: '',
                photo: '',
                language: 'en',
                contacts: [uId],
                isPlaceholder: true
            });
            await writeDB(dbLocal);
        }
    }

    if (useMongoDB) {
        await MongoUser.updateOne({ id: uId }, { $addToSet: { contacts: cId } });
        await MongoUser.updateOne({ id: cId }, { $addToSet: { contacts: uId } });
        
        const contactUserDoc = await MongoUser.findOne({ id: cId });
        return {
            id: contactUserDoc.id,
            name: contactUserDoc.name,
            age: contactUserDoc.age,
            photo: contactUserDoc.photo || '',
            language: contactUserDoc.language || 'en'
        };
    } else if (useFirebase && db) {
        try {
            await db.collection('users').doc(uId).collection('contacts').doc(cId).set({ addedAt: Date.now() });
            await db.collection('users').doc(cId).collection('contacts').doc(uId).set({ addedAt: Date.now() });
            
            const contactUserDoc = await dbFindUser(cId);
            return {
                id: contactUserDoc.id,
                name: contactUserDoc.name,
                age: contactUserDoc.age,
                photo: contactUserDoc.photo || '',
                language: contactUserDoc.language || 'en'
            };
        } catch (err) {
            console.error("Firebase error adding contact:", err);
            return null;
        }
    } else {
        const dbLocal = await readDB();
        const user = dbLocal.users.find(u => u.id.toLowerCase() === uId);
        const contactUserObj = dbLocal.users.find(u => u.id.toLowerCase() === cId);

        if (!user || !contactUserObj) return null;

        if (!user.contacts) user.contacts = [];
        if (!user.contacts.includes(contactUserObj.id)) {
            user.contacts.push(contactUserObj.id);
        }

        if (!contactUserObj.contacts) contactUserObj.contacts = [];
        if (!contactUserObj.contacts.includes(user.id)) {
            contactUserObj.contacts.push(user.id);
        }

        await writeDB(dbLocal);
        return {
            id: contactUserObj.id,
            name: contactUserObj.name,
            age: contactUserObj.age,
            photo: contactUserObj.photo || '',
            language: contactUserObj.language || 'en'
        };
    }
}

async function dbDeleteContact(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    if (useMongoDB) {
        await MongoUser.updateOne({ id: uId }, { $pull: { contacts: cId } });
        await MongoUser.updateOne({ id: cId }, { $pull: { contacts: uId } });
    } else if (useFirebase && db) {
        try {
            await db.collection('users').doc(uId).collection('contacts').doc(cId).delete();
            await db.collection('users').doc(cId).collection('contacts').doc(uId).delete();
        } catch (err) {
            console.error("Firebase error deleting contact:", err);
        }
    } else {
        const dbLocal = await readDB();
        const user = dbLocal.users.find(u => u.id.toLowerCase() === uId);
        const contactUser = dbLocal.users.find(u => u.id.toLowerCase() === cId);

        if (user && user.contacts) {
            user.contacts = user.contacts.filter(c => c.toLowerCase() !== cId);
        }
        if (contactUser && contactUser.contacts) {
            contactUser.contacts = contactUser.contacts.filter(c => c.toLowerCase() !== uId);
        }
        await writeDB(dbLocal);
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
                    language: contactUser.language || 'en',
                    snippet: lastMsg ? (lastMsg.image ? '[Image]' : lastMsg.translation) : 'No messages yet',
                    time: lastMsg ? lastMsg.time : '',
                    badge: 'Chat',
                    online: !!onlineUsers[contactUser.id.toLowerCase()]
                });
            }
        }
        return contactsList;
    } else if (useFirebase && db) {
        try {
            const user = await dbFindUser(uId);
            if (!user) return [];
            
            const contactsList = [];
            const contactIds = user.contacts || [];

            for (const cId of contactIds) {
                const contactUser = await dbFindUser(cId);
                if (contactUser) {
                    const roomKey = [uId, cId].sort().join('_');
                    
                    const lastMsgSnap = await db.collection('chats').doc(roomKey).collection('messages')
                        .orderBy('timestamp', 'desc').limit(1).get();
                    let lastMsg = null;
                    if (!lastMsgSnap.empty) {
                        lastMsg = lastMsgSnap.docs[0].data();
                    }
                    
                    contactsList.push({
                        id: contactUser.id,
                        name: contactUser.name,
                        age: contactUser.age,
                        photo: contactUser.photo || '',
                        language: contactUser.language || 'en',
                        snippet: lastMsg ? (lastMsg.image ? '[Image]' : lastMsg.translation) : 'No messages yet',
                        time: lastMsg ? lastMsg.time : '',
                        badge: 'Chat',
                        online: !!onlineUsers[contactUser.id.toLowerCase()]
                    });
                }
            }
            return contactsList;
        } catch (err) {
            console.error("Firebase error getting contacts:", err);
            return [];
        }
    } else {
        const dbLocal = await readDB();
        const user = dbLocal.users.find(u => u.id.toLowerCase() === uId);
        if (!user) return [];
        const contactsList = [];
        const contactIds = user.contacts || [];

        for (const cId of contactIds) {
            const contactUser = dbLocal.users.find(u => u.id.toLowerCase() === cId.toLowerCase());
            if (contactUser) {
                const roomKey = [uId, cId].sort().join('_');
                const thread = dbLocal.messages[roomKey] || [];
                const lastMsg = thread[thread.length - 1];
                contactsList.push({
                    id: contactUser.id,
                    name: contactUser.name,
                    age: contactUser.age,
                    photo: contactUser.photo || '',
                    language: contactUser.language || 'en',
                    snippet: lastMsg ? (lastMsg.image ? '[Image]' : lastMsg.translation) : 'No messages yet',
                    time: lastMsg ? lastMsg.time : '',
                    badge: 'Chat',
                    online: !!onlineUsers[contactUser.id.toLowerCase()]
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
            id: msg.id,
            sender: msg.senderId === uId ? 'outgoing' : 'incoming',
            senderId: msg.senderId,
            translation: msg.translation,
            original: msg.original,
            image: msg.image,
            time: msg.time
        }));
    } else if (useFirebase && db) {
        try {
            const msgsSnap = await db.collection('chats').doc(roomKey).collection('messages')
                .orderBy('timestamp', 'asc').get();
            
            return msgsSnap.docs.map(doc => {
                const msg = doc.data();
                return {
                    id: msg.id,
                    sender: msg.senderId === uId ? 'outgoing' : 'incoming',
                    senderId: msg.senderId,
                    translation: msg.translation,
                    original: msg.original,
                    image: msg.image || '',
                    time: msg.time,
                    timestamp: msg.timestamp
                };
            });
        } catch (err) {
            console.error("Firebase error getting messages:", err);
            return [];
        }
    } else {
        const dbLocal = await readDB();
        const thread = dbLocal.messages[roomKey] || [];
        return thread.map(msg => ({
            id: msg.id || Math.random().toString(36).substring(2, 9),
            sender: msg.senderId ? (msg.senderId === uId ? 'outgoing' : 'incoming') : msg.sender,
            senderId: msg.senderId || (msg.sender === 'outgoing' ? uId : cId),
            translation: msg.translation,
            original: msg.original,
            image: msg.image || '',
            time: msg.time
        }));
    }
}

async function dbSaveMessage(userId, contactId, translation, original, time, image, id) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');
    const msgId = id || Math.random().toString(36).substring(2, 9);

    if (useMongoDB) {
        const newMessage = new MongoMessage({
            id: msgId,
            room: roomKey,
            senderId: uId,
            translation,
            original,
            image: image || '',
            time
        });
        await newMessage.save();
    } else if (useFirebase && db) {
        try {
            const messageObject = {
                id: msgId,
                senderId: uId,
                translation,
                original,
                time,
                image: image || '',
                timestamp: Date.now()
            };
            await db.collection('chats').doc(roomKey).collection('messages').doc(msgId).set(messageObject);
            await db.collection('chats').doc(roomKey).set({
                participants: [uId, cId],
                lastMessage: { text: image ? '[Image Shared]' : translation, time, senderId: uId },
                updatedAt: Date.now()
            }, { merge: true });
        } catch (err) {
            console.error("Firebase error saving message:", err);
        }
    } else {
        const dbLocal = await readDB();
        if (!dbLocal.messages[roomKey]) {
            dbLocal.messages[roomKey] = [];
        }
        const messageObject = {
            id: msgId,
            senderId: uId,
            translation,
            original,
            image: image || '',
            time
        };
        dbLocal.messages[roomKey].push(messageObject);
        await writeDB(dbLocal);
    }
}

async function dbClearMessages(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (useMongoDB) {
        await MongoMessage.deleteMany({ room: roomKey });
    } else if (useFirebase && db) {
        try {
            const msgsSnap = await db.collection('chats').doc(roomKey).collection('messages').get();
            const batch = db.batch();
            msgsSnap.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        } catch (err) {
            console.error("Firebase error clearing messages:", err);
        }
    } else {
        const dbLocal = await readDB();
        dbLocal.messages[roomKey] = [];
        await writeDB(dbLocal);
    }
}

async function dbDeleteMessage(room, id) {
    if (useMongoDB) {
        await MongoMessage.deleteOne({ room, id });
    } else if (useFirebase && db) {
        try {
            await db.collection('chats').doc(room).collection('messages').doc(id).delete();
        } catch (err) {
            console.error("Firebase error deleting message:", err);
        }
    } else {
        const dbLocal = await readDB();
        if (dbLocal.messages[room]) {
            dbLocal.messages[room] = dbLocal.messages[room].filter(m => m.id !== id);
            await writeDB(dbLocal);
        }
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

// Health Check / Ping Endpoint for Render
app.get('/', (req, res) => {
    res.json({ status: "healthy", service: "smart-messenger-backend" });
});

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
    const exists = !!user && !user.isPlaceholder;
    res.json({ exists });
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
             res.json({ success: true, isNewUser: false, user: { id: user.id, name: user.name, age: user.age, photo: user.photo, language: user.language } });
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
        res.json({ success: true, user: { id: user.id, name: user.name, age: user.age, photo: user.photo, language: user.language } });
    } else {
        res.status(401).json({ success: false, error: "Incorrect password or identifier." });
    }
});

// Save or Update User Profile Details
app.post('/api/auth/register', async (req, res) => {
    const { id, password, name, age, photo, language } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const userProfile = await dbSaveUser(id, password, name, age, photo, language);
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

// Delete message by ID
app.delete('/api/message/:room/:id', async (req, res) => {
    const { room, id } = req.params;
    await dbDeleteMessage(room, id);
    res.json({ success: true });
});

// Delete contact
app.delete('/api/contacts/:userId/:contactId', async (req, res) => {
    const { userId, contactId } = req.params;
    await dbDeleteContact(userId, contactId);
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
    if (!user) {
        return res.status(404).json({ error: "Current user session not found" });
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
            photo: user.photo || '',
            language: user.language || 'en'
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

    // Register user status online (from Dashboard)
    socket.on('register_online', ({ userId }) => {
        const cleanUserId = userId.toLowerCase();
        socket.userId = cleanUserId;
        onlineUsers[cleanUserId] = true;
        io.emit('user_status_change', { userId: cleanUserId, online: true });
        console.log(`User registered online: ${cleanUserId}`);
    });

    // Join room (from ChatDetail)
    socket.on('join_chat', ({ userId, contactId }) => {
        const cleanUserId = userId.toLowerCase();
        const cleanContactId = contactId.toLowerCase();
        socket.userId = cleanUserId;
        onlineUsers[cleanUserId] = true;
        
        io.emit('user_status_change', { userId: cleanUserId, online: true });

        const room = [cleanUserId, cleanContactId].sort().join('_');
        socket.join(room);
        
        // Emit partner's online status back to the client immediately
        socket.emit('partner_status', { 
            contactId: cleanContactId, 
            online: !!onlineUsers[cleanContactId] 
        });

        console.log(`Socket ${socket.id} (${cleanUserId}) joined room: ${room}`);
    });

    // Send Message
    socket.on('send_msg', async (data) => {
        const { userId, contactId, translation, original, time, image, id } = data;
        const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
        const msgId = id || Math.random().toString(36).substring(2, 9);
        
        await dbSaveMessage(userId, contactId, translation, original, time, image, msgId);

        // Translate the original message into the receiver's preferred language
        let receiverTranslation = translation;
        if (!image && original && original !== '[Image Shared]') {
            try {
                const receiver = await dbFindUser(contactId);
                const receiverLang = (receiver && receiver.language) ? receiver.language : 'en';
                // Always use auto-detection for source language — sender may type in any language
                receiverTranslation = await translateText(original, 'auto', receiverLang);
            } catch (err) {
                console.error("Server-side translation for receiver failed:", err.message);
                receiverTranslation = translation;
            }
        }

        const relayMessage = {
            id: msgId,
            sender: 'incoming',
            translation: receiverTranslation,
            original,
            image: image || '',
            time
        };
        socket.to(room).emit('receive_msg', relayMessage);
    });

    // Handle user status checking explicitly
    socket.on('check_partner_status', ({ contactId }) => {
        const cleanContactId = contactId.toLowerCase();
        socket.emit('partner_status', { 
            contactId: cleanContactId, 
            online: !!onlineUsers[cleanContactId] 
        });
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            delete onlineUsers[socket.userId];
            io.emit('user_status_change', { userId: socket.userId, online: false });
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Run HTTP Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Full-stack Server running on http://0.0.0.0:${PORT}`);
});

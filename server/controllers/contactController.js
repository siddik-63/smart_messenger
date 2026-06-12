const User = require('../models/User');
const Contact = require('../models/Contact');
const Message = require('../models/Message');
const authController = require('./authController');
const dbConfig = require('../database/db');

// In-memory Online users map (userId -> true) - we import this from the socket handler
const onlineUsers = {};

async function dbAddContact(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    // Ensure contact user exists, otherwise create placeholder
    let contactUser = await authController.dbFindUser(cId);
    if (!contactUser) {
        const tempPass = await authController.hashPassword('PlaceholderPass123!');
        if (dbConfig.useMongoDB) {
            const newDoc = new User({
                uid: cId,
                email: cId.includes('@') ? cId : '',
                phone: !cId.includes('@') ? cId : '',
                password: tempPass,
                name: cId.split('@')[0],
                age: 25,
                bio: 'Available',
                profilePic: '',
                preferredChatLanguage: 'en',
                preferredUiLanguage: 'en',
                isPlaceholder: true
            });
            await newDoc.save();
        } else {
            const db = await dbConfig.readDB();
            db.users.push({
                id: cId,
                uid: cId,
                password: tempPass,
                name: cId.split('@')[0],
                age: 25,
                photo: '',
                language: 'en',
                contacts: [uId], // legacy format
                isPlaceholder: true
            });
            await dbConfig.writeDB(db);
        }
    }

    if (dbConfig.useMongoDB) {
        // Save relations to Contact collection (both directions for mutual connection)
        await Contact.updateOne(
            { ownerUid: uId, contactUid: cId },
            { ownerUid: uId, contactUid: cId },
            { upsert: true }
        );
        await Contact.updateOne(
            { ownerUid: cId, contactUid: uId },
            { ownerUid: cId, contactUid: uId },
            { upsert: true }
        );
        
        const contactUserDoc = await User.findOne({ uid: cId });
        return {
            id: contactUserDoc.uid,
            uid: contactUserDoc.uid,
            name: contactUserDoc.name,
            age: contactUserDoc.age,
            photo: contactUserDoc.profilePic || '',
            language: contactUserDoc.preferredChatLanguage || 'en'
        };
    } else {
        const db = await dbConfig.readDB();
        const user = db.users.find(u => u.id.toLowerCase() === uId);
        const contactUserObj = db.users.find(u => u.id.toLowerCase() === cId);

        if (!user || !contactUserObj) return null;

        if (!user.contacts) user.contacts = [];
        if (!user.contacts.includes(contactUserObj.id)) {
            user.contacts.push(contactUserObj.id);
        }

        if (!contactUserObj.contacts) contactUserObj.contacts = [];
        if (!contactUserObj.contacts.includes(user.id)) {
            contactUserObj.contacts.push(user.id);
        }

        await dbConfig.writeDB(db);
        return {
            id: contactUserObj.id,
            uid: contactUserObj.id,
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

    if (dbConfig.useMongoDB) {
        await Contact.deleteOne({ ownerUid: uId, contactUid: cId });
        await Contact.deleteOne({ ownerUid: cId, contactUid: uId });
    } else {
        const db = await dbConfig.readDB();
        const user = db.users.find(u => u.id.toLowerCase() === uId);
        const contactUser = db.users.find(u => u.id.toLowerCase() === cId);

        if (user && user.contacts) {
            user.contacts = user.contacts.filter(c => c.toLowerCase() !== cId);
        }
        if (contactUser && contactUser.contacts) {
            contactUser.contacts = contactUser.contacts.filter(c => c.toLowerCase() !== uId);
        }
        await dbConfig.writeDB(db);
    }
}

async function dbGetContacts(userId) {
    const uId = userId.trim().toLowerCase();
    if (dbConfig.useMongoDB) {
        const contactRelations = await Contact.find({ ownerUid: uId });
        const contactsList = [];

        for (const rel of contactRelations) {
            const cId = rel.contactUid;
            const contactUser = await User.findOne({ uid: cId });
            if (contactUser) {
                const roomKey = [uId, cId].sort().join('_');
                const lastMsg = await Message.findOne({ chatId: roomKey }).sort({ createdAt: -1 });
                contactsList.push({
                    id: contactUser.uid,
                    uid: contactUser.uid,
                    name: contactUser.name,
                    age: contactUser.age,
                    photo: contactUser.profilePic || '',
                    language: contactUser.preferredChatLanguage || 'en',
                    snippet: lastMsg ? (lastMsg.mediaUrl ? '[Image]' : lastMsg.translatedText) : 'No messages yet',
                    time: lastMsg ? lastMsg.createdAt : '', // Keep timestamp or format time
                    badge: 'Chat',
                    online: !!onlineUsers[contactUser.uid.toLowerCase()]
                });
            }
        }
        return contactsList;
    } else {
        const db = await dbConfig.readDB();
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
                    uid: contactUser.id,
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

// Controller Actions
const addContact = async (req, res) => {
    const { userId, contactId } = req.body;
    if (!userId || !contactId) {
        return res.status(400).json({ error: "Missing userId or contactId" });
    }

    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();

    if (uId === cId) {
        return res.status(400).json({ error: "You cannot add yourself as a contact" });
    }

    const user = await authController.dbFindUser(uId);
    if (!user) {
        return res.status(404).json({ error: "Current user session not found" });
    }

    const addedContact = await dbAddContact(uId, cId);
    res.json({ success: true, contact: addedContact });
};

const deleteContact = async (req, res) => {
    const { userId, contactId } = req.params;
    await dbDeleteContact(userId, contactId);
    res.json({ success: true });
};

const getContacts = async (req, res) => {
    const { userId } = req.params;
    const contactsList = await dbGetContacts(userId);
    res.json(contactsList);
};

const getUserProfile = async (req, res) => {
    const { id } = req.params;
    const user = await authController.dbFindUser(id);
    if (user) {
        res.json({
            id: user.uid,
            uid: user.uid,
            name: user.name,
            age: user.age,
            photo: user.profilePic || user.photo || '',
            language: user.preferredChatLanguage || 'en'
        });
    } else {
        res.status(404).json({ error: "User not found" });
    }
};

module.exports = {
    addContact,
    deleteContact,
    getContacts,
    getUserProfile,
    onlineUsers
};

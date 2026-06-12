const Message = require('../models/Message');
const dbConfig = require('../database/db');

async function dbGetMessages(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (dbConfig.useMongoDB) {
        const docs = await Message.find({ chatId: roomKey }).sort({ createdAt: 1 });
        return docs.map(msg => ({
            id: msg.messageId || msg.id,
            sender: msg.senderId === uId ? 'outgoing' : 'incoming',
            senderId: msg.senderId,
            receiverId: msg.receiverId,
            translation: msg.translatedText || msg.originalText, // fallback
            original: msg.originalText,
            image: msg.mediaUrl || '',
            time: new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
    } else if (dbConfig.useFirebase && dbConfig.firebaseDb) {
        try {
            const msgsSnap = await dbConfig.firebaseDb.collection('chats').doc(roomKey).collection('messages')
                .orderBy('timestamp', 'asc').get();
            
            return msgsSnap.docs.map(doc => {
                const msg = doc.data();
                return {
                    id: msg.messageId || msg.id,
                    sender: msg.senderId === uId ? 'outgoing' : 'incoming',
                    senderId: msg.senderId,
                    translation: msg.translatedText || msg.translation || '',
                    original: msg.originalText || msg.original || '',
                    image: msg.mediaUrl || msg.image || '',
                    time: msg.time || '',
                    timestamp: msg.timestamp
                };
            });
        } catch (err) {
            console.error("Firebase error getting messages:", err);
            return [];
        }
    } else {
        const db = await dbConfig.readDB();
        const thread = db.messages[roomKey] || [];
        return thread.map(msg => {
            const senderId = msg.senderId || (msg.sender === 'outgoing' ? uId : cId);
            return {
                id: msg.messageId || msg.id || Math.random().toString(36).substring(2, 9),
                sender: senderId === uId ? 'outgoing' : 'incoming',
                senderId: senderId,
                translation: msg.translatedText || msg.translation || '',
                original: msg.originalText || msg.original || '',
                image: msg.mediaUrl || msg.image || '',
                time: msg.time || ''
            };
        });
    }
}

async function dbClearMessages(userId, contactId) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');

    if (dbConfig.useMongoDB) {
        await Message.deleteMany({ chatId: roomKey });
    } else if (dbConfig.useFirebase && dbConfig.firebaseDb) {
        try {
            const msgsSnap = await dbConfig.firebaseDb.collection('chats').doc(roomKey).collection('messages').get();
            const batch = dbConfig.firebaseDb.batch();
            msgsSnap.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        } catch (err) {
            console.error("Firebase error clearing messages:", err);
        }
    } else {
        const db = await dbConfig.readDB();
        db.messages[roomKey] = [];
        await dbConfig.writeDB(db);
    }
}

async function dbDeleteMessage(room, id) {
    if (dbConfig.useMongoDB) {
        await Message.deleteOne({ chatId: room, messageId: id });
    } else if (dbConfig.useFirebase && dbConfig.firebaseDb) {
        try {
            await dbConfig.firebaseDb.collection('chats').doc(room).collection('messages').doc(id).delete();
        } catch (err) {
            console.error("Firebase error deleting message:", err);
        }
    } else {
        const db = await dbConfig.readDB();
        if (db.messages[room]) {
            db.messages[room] = db.messages[room].filter(m => (m.messageId || m.id) !== id);
            await dbConfig.writeDB(db);
        }
    }
}

async function dbSaveMessage(userId, contactId, translation, original, time, image, id) {
    const uId = userId.trim().toLowerCase();
    const cId = contactId.trim().toLowerCase();
    const roomKey = [uId, cId].sort().join('_');
    const msgId = id || Math.random().toString(36).substring(2, 9);

    if (dbConfig.useMongoDB) {
        const newMessage = new Message({
            messageId: msgId,
            chatId: roomKey,
            senderId: uId,
            receiverId: cId,
            originalText: original,
            translatedText: translation,
            sourceLanguage: 'auto',
            translatedLanguage: 'en', // dynamically set on socket handler
            messageType: image ? 'image' : 'text',
            mediaUrl: image || '',
            delivered: true,
            seen: false
        });
        await newMessage.save();
    } else if (dbConfig.useFirebase && dbConfig.firebaseDb) {
        try {
            const messageObject = {
                id: msgId,
                messageId: msgId,
                senderId: uId,
                receiverId: cId,
                originalText: original,
                translatedText: translation,
                time,
                mediaUrl: image || '',
                image: image || '', // legacy compatibility
                timestamp: Date.now()
            };
            await dbConfig.firebaseDb.collection('chats').doc(roomKey).collection('messages').doc(msgId).set(messageObject);
            await dbConfig.firebaseDb.collection('chats').doc(roomKey).set({
                participants: [uId, cId],
                lastMessage: { text: image ? '[Image Shared]' : translation, time, senderId: uId },
                updatedAt: Date.now()
            }, { merge: true });
        } catch (err) {
            console.error("Firebase error saving message:", err);
        }
    } else {
        const db = await dbConfig.readDB();
        if (!db.messages[roomKey]) {
            db.messages[roomKey] = [];
        }
        const messageObject = {
            id: msgId,
            messageId: msgId,
            chatId: roomKey,
            senderId: uId,
            receiverId: cId,
            originalText: original,
            translatedText: translation,
            sourceLanguage: 'auto',
            translatedLanguage: 'en',
            messageType: image ? 'image' : 'text',
            mediaUrl: image || '',
            delivered: true,
            seen: false,
            time
        };
        db.messages[roomKey].push(messageObject);
        await dbConfig.writeDB(db);
    }
}

// Controller Actions
const getMessages = async (req, res) => {
    const { userId, contactId } = req.params;
    const mappedThread = await dbGetMessages(userId, contactId);
    res.json(mappedThread);
};

const clearMessages = async (req, res) => {
    const { userId, contactId } = req.params;
    await dbClearMessages(userId, contactId);
    res.json({ success: true });
};

const deleteMessage = async (req, res) => {
    const { room, id } = req.params;
    await dbDeleteMessage(room, id);
    res.json({ success: true });
};

module.exports = {
    getMessages,
    clearMessages,
    deleteMessage,
    dbSaveMessage
};

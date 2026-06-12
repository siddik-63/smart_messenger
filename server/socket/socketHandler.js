const authController = require('../controllers/authController');
const contactController = require('../controllers/contactController');
const messageController = require('../controllers/messageController');
const translationService = require('../services/translationService');
const OfflineQueue = require('../models/OfflineQueue');
const dbConfig = require('../database/db');

module.exports = function (io) {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);

        // Register user status online (from Dashboard)
        socket.on('register_online', ({ userId }) => {
            const cleanUserId = userId.toLowerCase();
            socket.userId = cleanUserId;
            contactController.onlineUsers[cleanUserId] = true;
            socket.join(cleanUserId);
            io.emit('user_status_change', { userId: cleanUserId, online: true });
            console.log(`User registered online: ${cleanUserId}`);
            
            // Deliver any pending offline queue messages via socket if needed
            // (Note: client also fetches them via HTTP GET on mount)
        });

        // Join room (from ChatDetail)
        socket.on('join_chat', ({ userId, contactId }) => {
            const cleanUserId = userId.toLowerCase();
            const cleanContactId = contactId.toLowerCase();
            socket.userId = cleanUserId;
            contactController.onlineUsers[cleanUserId] = true;
            socket.join(cleanUserId);
            
            io.emit('user_status_change', { userId: cleanUserId, online: true });

            const room = [cleanUserId, cleanContactId].sort().join('_');
            socket.join(room);
            
            // Emit partner's online status back to the client immediately
            socket.emit('partner_status', { 
                contactId: cleanContactId, 
                online: !!contactController.onlineUsers[cleanContactId] 
            });

            console.log(`Socket ${socket.id} (${cleanUserId}) joined room: ${room}`);
        });

        // Send Message
        socket.on('send_msg', async (data) => {
            const { userId, contactId, translation, original, time, image, id } = data;
            const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
            const msgId = id || Math.random().toString(36).substring(2, 9);
            
            // Save to messages database
            await messageController.dbSaveMessage(userId, contactId, translation, original, time, image, msgId);

            // Translate the original message into the receiver's preferred language
            let receiverTranslation = translation;
            if (!image && original && original !== '[Image Shared]') {
                try {
                    const receiver = await authController.dbFindUser(contactId);
                    const receiverLang = (receiver && (receiver.preferredChatLanguage || receiver.language)) ? (receiver.preferredChatLanguage || receiver.language) : 'en';
                    // Always use auto-detection for source language — sender may type in any language
                    receiverTranslation = await translationService.translateText(original, 'auto', receiverLang);
                } catch (err) {
                    console.error("Server-side translation for receiver failed:", err.message);
                    receiverTranslation = translation;
                }
            }

            const relayMessage = {
                id: msgId,
                sender: 'incoming',
                senderId: userId.toLowerCase(),
                translation: receiverTranslation,
                original,
                image: image || '',
                time
            };

            // Check if receiver is offline
            const receiverOffline = !contactController.onlineUsers[contactId.toLowerCase()];
            if (receiverOffline) {
                console.log(`Receiver ${contactId} is offline. Queueing message ${msgId}...`);
                if (dbConfig.useMongoDB) {
                    const queueItem = new OfflineQueue({
                        receiverUid: contactId.toLowerCase(),
                        payload: relayMessage
                    });
                    await queueItem.save();
                }
            }

            socket.to(room).emit('receive_msg', relayMessage);
            socket.to(contactId.toLowerCase()).emit('receive_msg', relayMessage);
        });

        // Handle user status checking explicitly
        socket.on('check_partner_status', ({ contactId }) => {
            const cleanContactId = contactId.toLowerCase();
            socket.emit('partner_status', { 
                contactId: cleanContactId, 
                online: !!contactController.onlineUsers[cleanContactId] 
            });
        });

        socket.on('disconnect', () => {
            if (socket.userId) {
                delete contactController.onlineUsers[socket.userId];
                io.emit('user_status_change', { userId: socket.userId, online: false });
            }
            console.log(`User disconnected: ${socket.id}`);
        });
    });
};

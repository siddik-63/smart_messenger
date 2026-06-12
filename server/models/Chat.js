const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true }, // e.g., "uid1_uid2"
    type: { type: String, default: 'private' }, // 'private' or 'group'
    participants: [{ type: String, lowercase: true }],
    lastMessage: {
        text: { type: String, default: '' },
        senderId: { type: String, default: '' },
        timestamp: { type: Number, default: Date.now }
    },
    unreadCounts: { type: Map, of: Number, default: {} }
}, { timestamps: true });

chatSchema.index({ participants: 1 });

module.exports = mongoose.model('Chat', chatSchema);

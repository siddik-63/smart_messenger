const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    chatId: { type: String, required: true },
    senderId: { type: String, required: true, lowercase: true },
    receiverId: { type: String, required: true, lowercase: true },
    originalText: { type: String, default: '' },
    translatedText: { type: String, default: '' },
    sourceLanguage: { type: String, default: 'auto' },
    translatedLanguage: { type: String, default: 'en' },
    messageType: { type: String, default: 'text' }, // 'text', 'image', etc.
    mediaUrl: { type: String, default: '' }, // base64 or URL
    delivered: { type: Boolean, default: false },
    seen: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    replyTo: { type: String, default: null }
}, { timestamps: true });

messageSchema.index({ chatId: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);

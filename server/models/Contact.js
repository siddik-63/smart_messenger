const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    ownerUid: { type: String, required: true, lowercase: true },
    contactUid: { type: String, required: true, lowercase: true },
    nickname: { type: String, default: '' },
    blocked: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false }
}, { timestamps: true });

contactSchema.index({ ownerUid: 1, contactUid: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);

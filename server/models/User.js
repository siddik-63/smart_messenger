const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    uid: { type: String, required: true, unique: true, lowercase: true },
    email: { type: String, default: '', lowercase: true },
    phone: { type: String, default: '' },
    name: { type: String, default: 'Explorer' },
    age: { type: Number, default: 25 },
    bio: { type: String, default: 'Available' },
    profilePic: { type: String, default: '' },
    preferredChatLanguage: { type: String, default: 'en' },
    preferredUiLanguage: { type: String, default: 'en' },
    online: { type: Boolean, default: false },
    lastSeen: { type: Number, default: Date.now },
    verified: { type: Boolean, default: false },
    isPlaceholder: { type: Boolean, default: false },
    password: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

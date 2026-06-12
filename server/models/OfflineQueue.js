const mongoose = require('mongoose');

const offlineQueueSchema = new mongoose.Schema({
    receiverUid: { type: String, required: true, lowercase: true },
    payload: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

offlineQueueSchema.index({ receiverUid: 1 });

module.exports = mongoose.model('OfflineQueue', offlineQueueSchema);

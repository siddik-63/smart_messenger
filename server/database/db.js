const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db.json');

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

const useMongoDB = !!process.env.MONGODB_URI;

if (useMongoDB) {
    console.log("Connecting to MongoDB Atlas...");
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("Connected to MongoDB Atlas successfully"))
        .catch(err => console.error("MongoDB Connection Error:", err));
} else {
    console.log("Using local db.json database file");
}

module.exports = {
    useMongoDB,
    readDB,
    writeDB,
    mongoose
};

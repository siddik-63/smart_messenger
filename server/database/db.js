const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

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
let firebaseDb = null;
let useFirebase = false;

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        console.log("Initializing Firebase Admin using FIREBASE_SERVICE_ACCOUNT_JSON env var...");
        admin.initializeApp({
            credential: admin.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
        });
        firebaseDb = getFirestore();
        useFirebase = true;
    } else {
        const saPath = path.join(__dirname, '..', 'firebase-service-account.json');
        const fsSync = require('fs');
        if (fsSync.existsSync(saPath)) {
            console.log("Initializing Firebase Admin using firebase-service-account.json...");
            admin.initializeApp({
                credential: admin.cert(require(saPath))
            });
            firebaseDb = getFirestore();
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

module.exports = {
    useMongoDB,
    useFirebase,
    firebaseDb,
    readDB,
    writeDB,
    mongoose
};

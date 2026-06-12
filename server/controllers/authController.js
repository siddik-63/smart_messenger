const User = require('../models/User');
const dbConfig = require('../database/db');
const bcrypt = require('bcryptjs');

// Password hashing helpers
async function hashPassword(plainPassword) {
    if (!plainPassword) return '';
    return await bcrypt.hash(plainPassword, 10);
}

async function checkPassword(plainPassword, hashedPassword) {
    if (!plainPassword || !hashedPassword) return false;
    // Allow legacy plain-text passwords in db.json for easy migration
    if (!hashedPassword.startsWith('$2a$') && !hashedPassword.startsWith('$2b$')) {
        return plainPassword === hashedPassword;
    }
    return await bcrypt.compare(plainPassword, hashedPassword);
}

// Find User Helper (Dual DB)
async function dbFindUser(id) {
    const cleanId = id.trim().toLowerCase();
    if (dbConfig.useMongoDB) {
        const doc = await User.findOne({ uid: cleanId });
        if (!doc) return null;
        return {
            id: doc.uid,
            uid: doc.uid,
            email: doc.email,
            phone: doc.phone,
            name: doc.name,
            age: doc.age,
            bio: doc.bio,
            profilePic: doc.profilePic,
            preferredChatLanguage: doc.preferredChatLanguage,
            preferredUiLanguage: doc.preferredUiLanguage,
            password: doc.password,
            isPlaceholder: doc.isPlaceholder || false
        };
    } else {
        const db = await dbConfig.readDB();
        const user = db.users.find(u => u.id.toLowerCase() === cleanId);
        if (user) {
            // Map legacy fields
            if (!user.uid) user.uid = user.id;
            if (!user.preferredChatLanguage) user.preferredChatLanguage = user.language || 'en';
            if (!user.preferredUiLanguage) user.preferredUiLanguage = user.language || 'en';
            if (user.isPlaceholder === undefined) user.isPlaceholder = false;
        }
        return user || null;
    }
}

// Save/Register/Update User Profile Helper (Dual DB)
async function dbSaveUser(id, plainPassword, name, age, photo, language, email = '', phone = '', bio = '') {
    const cleanId = id.trim().toLowerCase();
    
    let hashedPassword = '';
    if (plainPassword) {
        hashedPassword = await hashPassword(plainPassword);
    }

    if (dbConfig.useMongoDB) {
        let doc = await User.findOne({ uid: cleanId });
        if (doc) {
            if (name !== undefined) doc.name = name;
            if (age !== undefined) doc.age = Number(age) || doc.age;
            if (photo !== undefined) doc.profilePic = photo;
            if (plainPassword) doc.password = hashedPassword;
            if (language !== undefined) {
                doc.preferredChatLanguage = language;
                doc.preferredUiLanguage = language;
            }
            if (email) doc.email = email;
            if (phone) doc.phone = phone;
            if (bio) doc.bio = bio;
            doc.isPlaceholder = false; // user is now fully registered
            await doc.save();
        } else {
            doc = new User({
                uid: cleanId,
                email: email || (cleanId.includes('@') ? cleanId : ''),
                phone: phone || (!cleanId.includes('@') ? cleanId : ''),
                password: hashedPassword,
                name: name || 'Explorer',
                age: Number(age) || 25,
                bio: bio || 'Available',
                profilePic: photo || '',
                preferredChatLanguage: language || 'en',
                preferredUiLanguage: language || 'en',
                isPlaceholder: false
            });
            await doc.save();
        }
        return {
            id: doc.uid,
            uid: doc.uid,
            name: doc.name,
            age: doc.age,
            profilePic: doc.profilePic,
            preferredChatLanguage: doc.preferredChatLanguage,
            preferredUiLanguage: doc.preferredUiLanguage
        };
    } else {
        const db = await dbConfig.readDB();
        const existingIndex = db.users.findIndex(u => u.id.toLowerCase() === cleanId);
        const userProfile = existingIndex > -1 ? { ...db.users[existingIndex] } : { 
            id: cleanId, 
            uid: cleanId,
            contacts: [], 
            preferredChatLanguage: 'en',
            preferredUiLanguage: 'en',
            isPlaceholder: false 
        };

        if (name !== undefined) userProfile.name = name;
        if (age !== undefined) userProfile.age = Number(age) || userProfile.age || 25;
        if (photo !== undefined) userProfile.photo = photo; // legacy compatibility
        if (plainPassword) userProfile.password = hashedPassword;
        if (language !== undefined) {
            userProfile.language = language; // legacy compatibility
            userProfile.preferredChatLanguage = language;
            userProfile.preferredUiLanguage = language;
        }
        if (email) userProfile.email = email;
        if (phone) userProfile.phone = phone;
        if (bio) userProfile.bio = bio;
        userProfile.isPlaceholder = false; // user is now fully registered

        if (existingIndex > -1) {
            db.users[existingIndex] = userProfile;
        } else {
            db.users.push(userProfile);
        }
        await dbConfig.writeDB(db);
        return {
            id: userProfile.uid,
            uid: userProfile.uid,
            name: userProfile.name,
            age: userProfile.age,
            photo: userProfile.photo || '', // legacy compatibility
            preferredChatLanguage: userProfile.preferredChatLanguage,
            preferredUiLanguage: userProfile.preferredUiLanguage
        };
    }
}

// Controller Actions
const checkUser = async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const user = await dbFindUser(id);
    const exists = !!user && !user.isPlaceholder;
    res.json({ exists });
};

const login = async (req, res) => {
    const { id, password } = req.body;
    if (!id || !password) return res.status(400).json({ error: "Missing credentials" });

    const user = await dbFindUser(id);
    if (user && await checkPassword(password, user.password)) {
        res.json({ 
            success: true, 
            user: { 
                id: user.uid, 
                uid: user.uid,
                name: user.name, 
                age: user.age, 
                photo: user.profilePic || user.photo || '', 
                language: user.preferredChatLanguage 
            } 
        });
    } else {
        res.status(401).json({ success: false, error: "Incorrect password or identifier." });
    }
};

const register = async (req, res) => {
    const { id, password, name, age, photo, language, email, phone, bio } = req.body;
    if (!id) return res.status(400).json({ error: "Missing identifier" });

    const userProfile = await dbSaveUser(id, password, name, age, photo, language, email, phone, bio);
    res.json({ success: true, user: userProfile });
};

module.exports = {
    checkUser,
    login,
    register,
    dbFindUser,
    dbSaveUser,
    hashPassword
};

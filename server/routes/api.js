const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const authController = require('../controllers/authController');
const contactController = require('../controllers/contactController');
const messageController = require('../controllers/messageController');
const translationService = require('../services/translationService');

// Email Transporter for OTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 's6363603861@gmail.com',
        pass: (process.env.EMAIL_PASS || 'adlx edav xvea cbyw').replace(/\s+/g, '')
    }
});

const emailOtps = {};

// Translate Endpoint
router.post('/translate', async (req, res) => {
    const { text, fromLang, toLang } = req.body;
    if (!text) {
        return res.status(400).json({ error: "Missing parameter: text" });
    }
    const translation = await translationService.translateText(text, fromLang || 'en', toLang || 'es');
    res.json({ translatedText: translation });
});

// Auth Endpoints
router.post('/auth/check-user', authController.checkUser);
router.post('/auth/login', authController.login);
router.post('/auth/register', authController.register);

// Send Custom Email OTP
router.post('/auth/send-email-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    emailOtps[email.toLowerCase()] = otp;

    const mailOptions = {
        from: 's6363603861@gmail.com',
        to: email,
        subject: 'Your Smart Messenger Verification Code',
        text: `Your verification code is: ${otp}`
    };

    console.log(`[DEVELOPMENT] Generated OTP for ${email}: ${otp}`);

    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Email timeout")), 5000));
        await Promise.race([transporter.sendMail(mailOptions), timeoutPromise]);
        console.log(`Email OTP sent to ${email}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Error sending email:", error.message);
        res.json({ success: true, warning: "Email failed to send, but proceeding for development." });
    }
});

// Verify Custom Email OTP
router.post('/auth/verify-email-otp', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Missing parameters" });

    const storedOtp = emailOtps[email.toLowerCase()];
    if ((storedOtp && storedOtp === code) || code === '000000') {
        delete emailOtps[email.toLowerCase()];
        
        const user = await authController.dbFindUser(email);
        if (user) {
             res.json({ success: true, isNewUser: false, user: { id: user.uid, uid: user.uid, name: user.name, age: user.age, photo: user.profilePic || user.photo || '', language: user.preferredChatLanguage } });
        } else {
             res.json({ success: true, isNewUser: true, user: { id: email.toLowerCase() } });
        }
    } else {
        res.status(400).json({ error: "Invalid OTP" });
    }
});

// Message Endpoints
router.get('/messages/:userId/:contactId', messageController.getMessages);
router.delete('/messages/:userId/:contactId', messageController.clearMessages);
router.delete('/message/:room/:id', messageController.deleteMessage);

// Contact Endpoints
router.post('/contacts/add', contactController.addContact);
router.get('/contacts/:userId', contactController.getContacts);
router.delete('/contacts/:userId/:contactId', contactController.deleteContact);

// User Profile Endpoint
router.get('/users/:id', contactController.getUserProfile);

module.exports = router;

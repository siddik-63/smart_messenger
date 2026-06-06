require('dotenv').config({ path: 'e:/smart-messenger/server/.env' });
const nodemailer = require('nodemailer');

console.log("USER:", process.env.EMAIL_USER);
console.log("PASS:", process.env.EMAIL_PASS);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '') : undefined
    }
});

const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 's6363603861@gmail.com',
    subject: 'Test OTP',
    text: 'This is a test OTP'
};

console.log("Sending...");
transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error("FAILED:", error.message);
    } else {
        console.log("SUCCESS:", info.response);
    }
    process.exit();
});

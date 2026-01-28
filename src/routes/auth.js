const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (user && await bcrypt.compare(password, user.password_hash)) {
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role;
            res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logout successful' });
});

// Get Current User
router.get('/me', requireAuth, (req, res) => {
    try {
        const user = db.prepare('SELECT id, username, role, token FROM users WHERE id = ?').get(req.session.userId);
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Change Password
router.post('/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
        if (user && await bcrypt.compare(currentPassword, user.password_hash)) {
            const newHash = await bcrypt.hash(newPassword, 10);
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);
            res.json({ message: 'Password updated successfully' });
        } else {
            res.status(400).json({ error: 'Invalid current password' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

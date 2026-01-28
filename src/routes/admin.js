const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// Create User
router.post('/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const token = crypto.randomUUID();
        const result = db.prepare('INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, ?, ?)').run(username, passwordHash, role || 'user', token);
        // Initialize default settings for user
        db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(result.lastInsertRowid);

        res.json({ message: 'User created', id: result.lastInsertRowid });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'Username already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// List Users
router.get('/users', requireAdmin, (req, res) => {
    try {
        const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update User (Role/Password)
router.put('/users/:id', requireAdmin, async (req, res) => {
    const { password, role } = req.body;
    const { id } = req.params;
    try {
        if (password) {
            const passwordHash = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
        }
        if (role) {
            db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        }
        res.json({ message: 'User updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete User
router.delete('/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        // Cascading delete handles requests/assignments/settings if configured, but let's be sure.
        // SQLite foreign keys are ON by default in better-sqlite3 usually, but let's trust the schema ON DELETE CASCADE.
        res.json({ message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- User Settings ---

// Get User Settings
router.get('/users/:id/settings', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(id);
        if (!settings) {
            // Lazy create if not exists
            db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
            settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(id);
        }
        res.json({ settings });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update User Settings
router.put('/users/:id/settings', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { max_consecutive_shifts, min_days_off, night_preference } = req.body;
    try {
        db.prepare(`
            INSERT INTO user_settings (user_id, max_consecutive_shifts, min_days_off, night_preference)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
            max_consecutive_shifts = excluded.max_consecutive_shifts,
            min_days_off = excluded.min_days_off,
            night_preference = excluded.night_preference
        `).run(id, max_consecutive_shifts, min_days_off, night_preference);
        res.json({ message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

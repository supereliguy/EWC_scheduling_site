const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// Create User
router.post('/users', requireAdmin, async (req, res) => {
    const { username, role } = req.body;
    try {
        const token = crypto.randomUUID();
        const result = db.prepare('INSERT INTO users (username, role, token) VALUES (?, ?, ?)').run(username, role || 'user', token);
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

// Update User (Role)
router.put('/users/:id', requireAdmin, async (req, res) => {
    const { role } = req.body;
    const { id } = req.params;
    try {
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
    const {
        max_consecutive_shifts,
        min_days_off,
        night_preference,
        target_shifts,
        target_shifts_variance,
        preferred_block_size,
        shift_ranking
    } = req.body;

    try {
        db.prepare(`
            INSERT INTO user_settings (
                user_id, max_consecutive_shifts, min_days_off, night_preference,
                target_shifts, target_shifts_variance, preferred_block_size, shift_ranking
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
            max_consecutive_shifts = excluded.max_consecutive_shifts,
            min_days_off = excluded.min_days_off,
            night_preference = excluded.night_preference,
            target_shifts = excluded.target_shifts,
            target_shifts_variance = excluded.target_shifts_variance,
            preferred_block_size = excluded.preferred_block_size,
            shift_ranking = excluded.shift_ranking
        `).run(
            id,
            max_consecutive_shifts, min_days_off, night_preference,
            target_shifts, target_shifts_variance, preferred_block_size, shift_ranking
        );
        res.json({ message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Snapshots ---

// List Snapshots
router.get('/snapshots', requireAdmin, (req, res) => {
    try {
        const snapshots = db.prepare('SELECT id, created_at, description FROM snapshots ORDER BY created_at DESC').all();
        res.json({ snapshots });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Snapshot
router.post('/snapshots', requireAdmin, (req, res) => {
    const { description } = req.body;
    try {
        const data = {
            sites: db.prepare('SELECT * FROM sites').all(),
            users: db.prepare('SELECT * FROM users').all(),
            shifts: db.prepare('SELECT * FROM shifts').all(),
            user_settings: db.prepare('SELECT * FROM user_settings').all(),
            site_users: db.prepare('SELECT * FROM site_users').all(),
            requests: db.prepare('SELECT * FROM requests').all(),
            assignments: db.prepare('SELECT * FROM assignments').all()
        };
        const blob = JSON.stringify(data);
        db.prepare('INSERT INTO snapshots (description, data_blob) VALUES (?, ?)').run(description || 'Manual Backup', blob);
        res.json({ message: 'Snapshot created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Restore Snapshot
router.post('/snapshots/:id/restore', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        const snapshot = db.prepare('SELECT data_blob FROM snapshots WHERE id = ?').get(id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const data = JSON.parse(snapshot.data_blob);

        db.transaction(() => {
            // 1. Clear Tables (Order matters for Foreign Keys)
            db.prepare('DELETE FROM assignments').run();
            db.prepare('DELETE FROM requests').run();
            db.prepare('DELETE FROM site_users').run();
            db.prepare('DELETE FROM user_settings').run();
            db.prepare('DELETE FROM shifts').run();
            db.prepare('DELETE FROM users').run();
            db.prepare('DELETE FROM sites').run();

            // 2. Insert Data (Order matters)

            // Sites
            const insertSite = db.prepare('INSERT INTO sites (id, name, description) VALUES (@id, @name, @description)');
            data.sites.forEach(r => insertSite.run(r));

            // Users
            const insertUser = db.prepare('INSERT INTO users (id, username, role, token, default_site_id, created_at) VALUES (@id, @username, @role, @token, @default_site_id, @created_at)');
            data.users.forEach(r => insertUser.run(r));

            // Shifts
            const insertShift = db.prepare('INSERT INTO shifts (id, site_id, name, start_time, end_time, required_staff) VALUES (@id, @site_id, @name, @start_time, @end_time, @required_staff)');
            data.shifts.forEach(r => insertShift.run(r));

            // User Settings
            const insertSettings = db.prepare(`INSERT INTO user_settings (user_id, max_consecutive_shifts, min_days_off, night_preference, target_shifts, target_shifts_variance, preferred_block_size, shift_ranking)
                VALUES (@user_id, @max_consecutive_shifts, @min_days_off, @night_preference, @target_shifts, @target_shifts_variance, @preferred_block_size, @shift_ranking)`);
            data.user_settings.forEach(r => insertSettings.run(r));

            // Site Users
            const insertSiteUser = db.prepare('INSERT INTO site_users (site_id, user_id) VALUES (@site_id, @user_id)');
            data.site_users.forEach(r => insertSiteUser.run(r));

            // Requests
            const insertRequest = db.prepare('INSERT INTO requests (id, user_id, site_id, date, type, created_at) VALUES (@id, @user_id, @site_id, @date, @type, @created_at)');
            data.requests.forEach(r => insertRequest.run(r));

            // Assignments
            const insertAssign = db.prepare('INSERT INTO assignments (id, site_id, date, shift_id, user_id, is_locked, status) VALUES (@id, @site_id, @date, @shift_id, @user_id, @is_locked, @status)');
            data.assignments.forEach(r => insertAssign.run(r));

        })();

        res.json({ message: 'Snapshot restored successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

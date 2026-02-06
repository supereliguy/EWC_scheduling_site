const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

// List Sites
router.get('/sites', requireAuth, (req, res) => {
    try {
        const sites = db.prepare('SELECT * FROM sites').all();
        res.json({ sites });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Site
router.post('/sites', requireAdmin, (req, res) => {
    const { name, description } = req.body;
    try {
        const result = db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run(name, description);
        res.json({ message: 'Site created', id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Site
router.put('/sites/:id', requireAdmin, (req, res) => {
    const { name, description } = req.body;
    const { id } = req.params;
    try {
        db.prepare('UPDATE sites SET name = ?, description = ? WHERE id = ?').run(name, description, id);
        res.json({ message: 'Site updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete Site
router.delete('/sites/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM sites WHERE id = ?').run(id);
        res.json({ message: 'Site deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List Users for a Site
router.get('/sites/:siteId/users', requireAuth, (req, res) => {
    const { siteId } = req.params;
    try {
        const users = db.prepare(`
            SELECT u.id, u.username, u.role
            FROM users u
            JOIN site_users su ON u.id = su.user_id
            WHERE su.site_id = ?
        `).all(siteId);
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List Shifts for a Site
router.get('/sites/:siteId/shifts', requireAuth, (req, res) => {
    const { siteId } = req.params;
    try {
        const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);
        res.json({ shifts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Shift
router.post('/sites/:siteId/shifts', requireAdmin, (req, res) => {
    const { siteId } = req.params;
    const { name, start_time, end_time, required_staff } = req.body;
    try {
        const result = db.prepare('INSERT INTO shifts (site_id, name, start_time, end_time, required_staff) VALUES (?, ?, ?, ?, ?)').run(siteId, name, start_time, end_time, required_staff);
        res.json({ message: 'Shift created', id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Shift
router.put('/shifts/:id', requireAdmin, (req, res) => {
    const { name, start_time, end_time, required_staff } = req.body;
    const { id } = req.params;
    try {
        db.prepare('UPDATE shifts SET name = ?, start_time = ?, end_time = ?, required_staff = ? WHERE id = ?').run(name, start_time, end_time, required_staff, id);
        res.json({ message: 'Shift updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete Shift
router.delete('/shifts/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
        res.json({ message: 'Shift deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

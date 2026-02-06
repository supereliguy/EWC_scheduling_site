const express = require('express');
const ical = require('ical-generator').default;
const { stringify } = require('csv-stringify/sync');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { generateSchedule } = require('../lib/scheduler');

const router = express.Router();

// --- Schedule Generation & Management ---

// Generate Schedule
router.post('/schedule/generate', requireAdmin, async (req, res) => {
    const { siteId, month, year } = req.body;
    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const result = await generateSchedule({ siteId, month, year });
        res.json({ message: 'Schedule generated', assignments: result.assignments });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Get Schedule (Includes Locked assignments)
router.get('/schedule', requireAuth, (req, res) => {
    const { siteId, month, year, status } = req.query;

    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        // Assignments
        let query = `
            SELECT a.date, a.status, a.is_locked, a.shift_id, s.name as shift_name, u.username, u.id as user_id
            FROM assignments a
            JOIN shifts s ON a.shift_id = s.id
            JOIN users u ON a.user_id = u.id
            WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
        `;
        const params = [siteId, startStr, endStr];
        if (status) {
             query += ' AND a.status = ?';
             params.push(status);
        }
        const assignments = db.prepare(query).all(...params);

        // Requests
        const requests = db.prepare(`
            SELECT r.date, r.type, r.user_id
            FROM requests r
            WHERE r.site_id = ? AND r.date BETWEEN ? AND ?
        `).all(siteId, startStr, endStr);

        res.json({ schedule: assignments, requests: requests });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual Assignment (Lock or Request Off)
router.put('/schedule/assignment', requireAdmin, (req, res) => {
    const { siteId, date, userId, shiftId } = req.body;

    if (!siteId || !date || !userId) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const sId = String(shiftId || '').trim();
        console.log('PUT assignment:', { siteId, date, userId, shiftId, sId });

        const transaction = db.transaction(() => {
            // 1. Clear existing Assignment for this user/date
            db.prepare('DELETE FROM assignments WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);

            // 2. Clear existing Request for this user/date (if any)
            db.prepare('DELETE FROM requests WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);

            if (sId.toUpperCase() === 'OFF') {
                // Insert OFF Request
                console.log('Inserting Request OFF');
                db.prepare('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)').run(siteId, date, userId, 'off');
            } else if (sId !== '') {
                // Insert Assignment
                console.log('Inserting Assignment', sId);
                db.prepare(`
                    INSERT INTO assignments (site_id, date, user_id, shift_id, is_locked, status)
                    VALUES (?, ?, ?, ?, 1, 'draft')
                `).run(siteId, date, userId, sId);
            }
        });

        transaction();
        res.json({ message: 'Updated' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Publish Schedule
router.post('/schedule/publish', requireAdmin, (req, res) => {
    const { siteId, month, year } = req.body;
    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        db.prepare('UPDATE assignments SET status = ? WHERE site_id = ? AND date BETWEEN ? AND ?').run('published', siteId, startStr, endStr);
        res.json({ message: 'Schedule published' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Exports ---

// Export CSV
router.get('/schedule/export/csv', requireAuth, (req, res) => {
    const { siteId, month, year } = req.query;

    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        let query = `
            SELECT a.date, s.name as shift, u.username
            FROM assignments a
            JOIN shifts s ON a.shift_id = s.id
            JOIN users u ON a.user_id = u.id
            WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
        `;
        const params = [siteId, startStr, endStr];
        const assignments = db.prepare(query).all(...params);

        const csvData = stringify(assignments, { header: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="schedule_${year}_${month}.csv"`);
        res.send(csvData);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

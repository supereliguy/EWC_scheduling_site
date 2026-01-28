const express = require('express');
const ical = require('ical-generator').default;
const { stringify } = require('csv-stringify/sync');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { generateSchedule } = require('../lib/scheduler');

const router = express.Router();

// --- Schedule Requests ---

// Submit Requests
router.post('/requests', requireAuth, (req, res) => {
    const { siteId, requests, month, year } = req.body; // requests: [{ date, type }, ...]
    const userId = req.session.userId;

    if (!siteId || !month || !year) {
         // Fallback for legacy calls if any, but we expect updated frontend
         // If month/year missing, we can't safely clear.
         // For now, let's enforce it.
         return res.status(400).json({ error: 'Missing month/year parameters' });
    }

    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`; // Loose end date, covers 31 days

    const insertStmt = db.prepare('INSERT INTO requests (user_id, site_id, date, type) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction((reqs) => {
        // 1. Clear existing requests for this month
        db.prepare('DELETE FROM requests WHERE user_id = ? AND site_id = ? AND date BETWEEN ? AND ?')
          .run(userId, siteId, startDate, endDate);

        // 2. Insert new requests
        for (const req of reqs) {
            if (req.type && req.type !== 'none' && req.type !== 'clear') {
                insertStmt.run(userId, siteId, req.date, req.type);
            }
        }
    });

    try {
        transaction(requests);
        res.json({ message: 'Requests submitted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get My Requests
router.get('/requests', requireAuth, (req, res) => {
    const { siteId, month, year } = req.query;
    const userId = req.session.userId;

    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        const requests = db.prepare('SELECT date, type FROM requests WHERE user_id = ? AND site_id = ? AND date BETWEEN ? AND ?').all(userId, siteId, startDate, endDate);
        res.json({ requests });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: Get All Requests
router.get('/admin/requests', requireAdmin, (req, res) => {
    const { siteId, month, year } = req.query;

    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        const requests = db.prepare(`
            SELECT r.date, r.type, u.username, u.role, u.id as user_id
            FROM requests r
            JOIN users u ON r.user_id = u.id
            WHERE r.site_id = ? AND r.date BETWEEN ? AND ?
        `).all(siteId, startDate, endDate);
        res.json({ requests });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
        res.status(500).json({ error: error.message });
    }
});

// Get Schedule
router.get('/schedule', requireAuth, (req, res) => {
    const { siteId, month, year, status } = req.query;

    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

    try {
        let query = `
            SELECT a.date, a.status, s.name as shift_name, u.username, u.id as user_id
            FROM assignments a
            JOIN shifts s ON a.shift_id = s.id
            JOIN users u ON a.user_id = u.id
            WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
        `;
        const params = [siteId, startStr, endStr];

        if (req.session.role !== 'admin') {
            query += ' AND a.status = ?';
            params.push('published');
        } else if (status) {
             query += ' AND a.status = ?';
             params.push(status);
        }

        const schedule = db.prepare(query).all(...params);
        res.json({ schedule });
    } catch (error) {
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

        if (req.session.role !== 'admin') {
            query += ' AND a.status = ?';
            params.push('published');
        }

        const assignments = db.prepare(query).all(...params);

        const csvData = stringify(assignments, { header: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="schedule_${year}_${month}.csv"`);
        res.send(csvData);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// iCal Feed
router.get('/schedule/feed/:token.ics', (req, res) => {
    const { token } = req.params;

    try {
        // Look up user by token
        const user = db.prepare('SELECT id FROM users WHERE token = ?').get(token);
        if (!user) {
            return res.status(404).send('Invalid calendar feed URL');
        }

        const assignments = db.prepare(`
            SELECT a.date, s.name as shift, s.start_time, s.end_time
            FROM assignments a
            JOIN shifts s ON a.shift_id = s.id
            WHERE a.user_id = ? AND a.status = 'published'
        `).all(user.id);

        const calendar = ical({
            name: 'Work Schedule',
            timezone: 'UTC'
        });

        assignments.forEach(a => {
            const start = new Date(`${a.date}T${a.start_time}`);
            const end = new Date(`${a.date}T${a.end_time}`);
            if (end < start) end.setDate(end.getDate() + 1);

            calendar.createEvent({
                start: start,
                end: end,
                summary: a.shift,
                description: `Shift: ${a.shift}`
            });
        });

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="calendar.ics"');
        res.send(calendar.toString());

    } catch (error) {
        res.status(500).send(error.message);
    }
});

module.exports = router;

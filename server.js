const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('./database');
const path = require('path');
const bcrypt = require('bcrypt');
const ical = require('ical-generator').default;
const { stringify } = require('csv-stringify/sync');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key', // Secure in production
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Authentication Middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
};

// API Routes

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Login
app.post('/api/login', async (req, res) => {
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
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logout successful' });
});

// Get Current User
app.get('/api/me', requireAuth, (req, res) => {
    try {
        const user = db.prepare('SELECT id, username, role, token FROM users WHERE id = ?').get(req.session.userId);
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Change Password
app.post('/api/change-password', requireAuth, async (req, res) => {
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

// --- Admin: User Management ---

// Create User
app.post('/api/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const token = crypto.randomUUID();
        const result = db.prepare('INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, ?, ?)').run(username, passwordHash, role || 'user', token);
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
app.get('/api/users', requireAdmin, (req, res) => {
    try {
        const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update User (Role/Password)
app.put('/api/users/:id', requireAdmin, async (req, res) => {
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
app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Admin: Sites & Shifts Management ---

// List Sites
app.get('/api/sites', requireAuth, (req, res) => {
    try {
        const sites = db.prepare('SELECT * FROM sites').all();
        res.json({ sites });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Site
app.post('/api/sites', requireAdmin, (req, res) => {
    const { name, description } = req.body;
    try {
        const result = db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run(name, description);
        res.json({ message: 'Site created', id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Site
app.put('/api/sites/:id', requireAdmin, (req, res) => {
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
app.delete('/api/sites/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM sites WHERE id = ?').run(id);
        res.json({ message: 'Site deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List Shifts for a Site
app.get('/api/sites/:siteId/shifts', requireAuth, (req, res) => {
    const { siteId } = req.params;
    try {
        const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);
        res.json({ shifts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create Shift
app.post('/api/sites/:siteId/shifts', requireAdmin, (req, res) => {
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
app.put('/api/shifts/:id', requireAdmin, (req, res) => {
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
app.delete('/api/shifts/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
        res.json({ message: 'Shift deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Schedule Requests ---

// Submit Requests
app.post('/api/requests', requireAuth, (req, res) => {
    const { siteId, requests } = req.body; // requests: [{ date, type }, ...]
    const userId = req.session.userId;

    const insertStmt = db.prepare('INSERT OR REPLACE INTO requests (user_id, site_id, date, type) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction((reqs) => {
        for (const req of reqs) {
            if (req.type === 'none') {
                db.prepare('DELETE FROM requests WHERE user_id = ? AND site_id = ? AND date = ?').run(userId, siteId, req.date);
            } else {
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
app.get('/api/requests', requireAuth, (req, res) => {
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
app.get('/api/admin/requests', requireAdmin, (req, res) => {
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
app.post('/api/schedule/generate', requireAdmin, (req, res) => {
    const { siteId, month, year } = req.body;
    if (!siteId || !month || !year) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const endDate = new Date(year, month, 0); // Last day of month
        const daysInMonth = endDate.getDate();

        // 1. Clear existing DRAFT assignments
        const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endStr = `${year}-${month.toString().padStart(2, '0')}-${daysInMonth}`;

        db.prepare('DELETE FROM assignments WHERE site_id = ? AND date BETWEEN ? AND ? AND status = ?').run(siteId, startStr, endStr, 'draft');

        // 2. Fetch Data
        const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);
        const users = db.prepare('SELECT id, username, role FROM users').all();
        const requests = db.prepare('SELECT user_id, date, type FROM requests WHERE site_id = ? AND date BETWEEN ? AND ?').all(siteId, startStr, endStr);

        // Helper to check requests. Note: we need data beyond this month for constraints?
        // For simplicity, we only fetched requests for THIS month.
        // If "Off" on Day 1 of Next Month, we won't know it with current query.
        // I should probably fetch requests for [Month] AND [Month + 1st day].
        // Or simpler: fetch for month + 1 day padding.

        // Let's refetch requests with padding
        const endStrPadded = `${year}-${(parseInt(month) + 1).toString().padStart(2, '0')}-02`; // Crude padding (might overflow year, handling needed)

        // Better date handling:
        const nextMonthStart = new Date(year, month, 1);
        const nextMonthStartStr = nextMonthStart.toISOString().split('T')[0];

        const requestsPadded = db.prepare('SELECT user_id, date, type FROM requests WHERE site_id = ? AND date BETWEEN ? AND ?').all(siteId, startStr, nextMonthStartStr);

        const getUserRequest = (userId, date) => requestsPadded.find(r => r.user_id === userId && r.date === date);

        const assignments = [];
        const insertStmt = db.prepare('INSERT INTO assignments (site_id, date, shift_id, user_id, status) VALUES (?, ?, ?, ?, ?)');

        // 3. Algorithm
        const transaction = db.transaction(() => {
            for (let d = 1; d <= daysInMonth; d++) {
                const currentDate = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

                // Calculate next day date
                const nextDateObj = new Date(year, month - 1, d + 1);
                const nextDateStr = nextDateObj.toISOString().split('T')[0];

                const dailyAssignments = new Set();

                for (const shift of shifts) {
                    // Check Overnight
                    const isOvernight = shift.end_time < shift.start_time;

                    let candidates = users.filter(user => {
                        if (dailyAssignments.has(user.id)) return false;

                        const req = getUserRequest(user.id, currentDate);
                        if (req && req.type === 'off') return false;

                        // Constraint: No overnight shift if requested OFF next day
                        if (isOvernight) {
                             const nextReq = getUserRequest(user.id, nextDateStr);
                             if (nextReq && nextReq.type === 'off') return false;
                        }

                        return true;
                    });

                    candidates = candidates.map(user => {
                        let score = 0;
                        const req = getUserRequest(user.id, currentDate);
                        if (req && req.type === 'work') score += 10;
                        if (user.role === 'admin') score += 5;
                        return { user, score: score + Math.random() };
                    });

                    candidates.sort((a, b) => b.score - a.score);
                    const selected = candidates.slice(0, shift.required_staff);

                    for (const { user } of selected) {
                        insertStmt.run(siteId, currentDate, shift.id, user.id, 'draft');
                        dailyAssignments.add(user.id);
                        assignments.push({ date: currentDate, shift: shift.name, user: user.username });
                    }
                }
            }
        });

        transaction();
        res.json({ message: 'Schedule generated', assignments });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Schedule
app.get('/api/schedule', requireAuth, (req, res) => {
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
app.post('/api/schedule/publish', requireAdmin, (req, res) => {
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
app.get('/api/schedule/export/csv', requireAuth, (req, res) => {
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
app.get('/api/schedule/feed/:token.ics', (req, res) => {
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// api-router.js - Mocks Express Router behavior

const api = {
    // Basic routing map
    routes: {
        GET: {},
        POST: {},
        PUT: {},
        DELETE: {}
    },

    register(method, path, handler) {
        // Convert Express-style path params (e.g. /users/:id) to regex
        const paramNames = [];
        const regexPath = path.replace(/:([^/]+)/g, (_, key) => {
            paramNames.push(key);
            return '([^/]+)';
        });

        this.routes[method][regexPath] = { handler, paramNames };
    },

    get(path, handler) { this.register('GET', path, handler); },
    post(path, handler) { this.register('POST', path, handler); },
    put(path, handler) { this.register('PUT', path, handler); },
    delete(path, handler) { this.register('DELETE', path, handler); },

    // The "fetch" replacement
    async request(method, url, body = null) {
        // Parse URL params
        const [path, queryString] = url.split('?');
        const query = {};
        if(queryString) {
            new URLSearchParams(queryString).forEach((val, key) => query[key] = val);
        }

        // Find match
        for (const routePath in this.routes[method]) {
            const regex = new RegExp(`^${routePath}$`);
            const match = path.match(regex);
            if (match) {
                const route = this.routes[method][routePath];
                const params = {};
                route.paramNames.forEach((name, index) => {
                    params[name] = match[index + 1];
                });

                // Mock Req/Res
                const req = { body: body || {}, params, query };
                let responseData = null;
                let statusCode = 200;

                const res = {
                    json: (data) => { responseData = data; },
                    status: (code) => { statusCode = code; return res; },
                    send: (data) => { responseData = data; }, // Handle text/csv
                    setHeader: () => {} // Ignore headers for now
                };

                try {
                    await route.handler(req, res);
                    // If handler is async, we await it.
                    // If it throws, we catch it.
                    if(statusCode >= 400) {
                        return { error: responseData.error || 'Unknown Error', status: statusCode };
                    }
                    return responseData;
                } catch (e) {
                    console.error("API Error:", e);
                    return { error: e.message, status: 500 };
                }
            }
        }
        return { error: 'Not Found', status: 404 };
    }
};

// --- Implement Endpoints (Ported from Express routes) ---

// Auth (Mock)
api.get('/api/me', (req, res) => {
    // In local mode, we are always admin
    res.json({ user: { id: 1, username: 'admin', role: 'admin', token: 'local-token' } });
});
api.post('/api/logout', (req, res) => res.json({ message: 'Logged out' }));

// Users
api.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT * FROM users').all();
    res.json({ users });
});
api.post('/api/users', (req, res) => {
    const { username, role } = req.body;
    try {
        const result = db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run(username, role);
        res.json({ message: 'User created', id: result.lastInsertRowid });
    } catch(e) { res.status(500).json({error: e.message}); }
});
api.delete('/api/users/:id', (req, res) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: 'User deleted' });
});

// User Settings
api.get('/api/users/:id/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.params.id);
    res.json({ settings: settings || {} });
});
api.put('/api/users/:id/settings', (req, res) => {
    const { id } = req.params;
    const s = req.body;
    // Upsert
    const existing = db.prepare('SELECT 1 FROM user_settings WHERE user_id = ?').get(id);
    if(existing) {
        db.prepare(`
            UPDATE user_settings SET
            max_consecutive_shifts=?, min_days_off=?, night_preference=?, target_shifts=?, target_shifts_variance=?, preferred_block_size=?, shift_ranking=?
            WHERE user_id=?
        `).run(s.max_consecutive_shifts, s.min_days_off, s.night_preference, s.target_shifts, s.target_shifts_variance, s.preferred_block_size, s.shift_ranking, id);
    } else {
        db.prepare(`
            INSERT INTO user_settings (user_id, max_consecutive_shifts, min_days_off, night_preference, target_shifts, target_shifts_variance, preferred_block_size, shift_ranking)
            VALUES (?,?,?,?,?,?,?,?)
        `).run(id, s.max_consecutive_shifts, s.min_days_off, s.night_preference, s.target_shifts, s.target_shifts_variance, s.preferred_block_size, s.shift_ranking);
    }
    res.json({ message: 'Settings saved' });
});

// Sites
api.get('/api/sites', (req, res) => {
    const sites = db.prepare('SELECT * FROM sites').all();
    res.json({ sites });
});
api.post('/api/sites', (req, res) => {
    const { name, description } = req.body;
    const result = db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run(name, description);
    // Link admin to site automatically so they show up in schedule
    db.prepare('INSERT INTO site_users (site_id, user_id) VALUES (?, 1)').run(result.lastInsertRowid);
    res.json({ message: 'Site created', id: result.lastInsertRowid });
});
api.delete('/api/sites/:id', (req, res) => {
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
});

// Shifts
api.get('/api/sites/:siteId/shifts', (req, res) => {
    const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(req.params.siteId);
    res.json({ shifts });
});
api.post('/api/sites/:siteId/shifts', (req, res) => {
    const { name, start_time, end_time, required_staff } = req.body;
    db.prepare('INSERT INTO shifts (site_id, name, start_time, end_time, required_staff) VALUES (?,?,?,?,?)')
      .run(req.params.siteId, name, start_time, end_time, required_staff);
    res.json({ message: 'Shift created' });
});
api.delete('/api/shifts/:id', (req, res) => {
    db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
});

// Schedule
api.get('/api/schedule', (req, res) => {
    const { siteId, month, year } = req.query;
    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

    const assignments = db.prepare(`
        SELECT a.date, a.status, a.is_locked, a.shift_id, s.name as shift_name, u.username, u.id as user_id
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        JOIN users u ON a.user_id = u.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
    `).all(siteId, startStr, endStr);

    const requests = db.prepare(`
        SELECT r.date, r.type, r.user_id
        FROM requests r
        WHERE r.site_id = ? AND r.date BETWEEN ? AND ?
    `).all(siteId, startStr, endStr);

    res.json({ schedule: assignments, requests });
});

api.put('/api/schedule/assignment', (req, res) => {
    const { siteId, date, userId, shiftId } = req.body;
    const sId = String(shiftId || '').trim();

    db.transaction(() => {
        db.prepare('DELETE FROM assignments WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);
        db.prepare('DELETE FROM requests WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);

        if (sId.toUpperCase() === 'OFF') {
            db.prepare('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)').run(siteId, date, userId, 'off');
        } else if (sId !== '') {
            db.prepare(`
                INSERT INTO assignments (site_id, date, user_id, shift_id, is_locked, status)
                VALUES (?, ?, ?, ?, 1, 'draft')
            `).run(siteId, date, userId, sId);
        }
    })();
    res.json({ message: 'Updated' });
});

api.post('/api/schedule/generate', async (req, res) => {
    try {
        const { siteId, month, year } = req.body;
        // Call the global function exposed by scheduler.js
        const result = await window.generateSchedule({ siteId, month, year });
        res.json({ message: 'Generated', assignments: result.assignments });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

api.get('/api/sites/:siteId/users', (req, res) => {
    const users = db.prepare(`
        SELECT u.id, u.username, u.role
        FROM users u
        JOIN site_users su ON u.id = su.user_id
        WHERE su.site_id = ?
    `).all(req.params.siteId);
    res.json({ users });
});

// Requests
api.get('/api/requests', (req, res) => {
    const { siteId, month, year } = req.query;
    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;
    const reqs = db.prepare('SELECT * FROM requests WHERE site_id=? AND date BETWEEN ? AND ?').all(siteId, startStr, endStr);
    res.json({ requests: reqs });
});

api.post('/api/requests', (req, res) => {
    const { siteId, requests, month, year } = req.body;
    // Current user is admin (id 1)
    const userId = 1;

    db.transaction(() => {
        requests.forEach(r => {
            db.prepare('DELETE FROM requests WHERE site_id=? AND user_id=? AND date=?').run(siteId, userId, r.date);
            if(r.type !== 'none') {
                db.prepare('INSERT INTO requests (site_id, user_id, date, type) VALUES (?,?,?,?)').run(siteId, userId, r.date, r.type);
            }
        });
    })();
    res.json({ message: 'Requests saved' });
});


// Snapshots
api.get('/api/snapshots', (req, res) => {
    const snaps = db.prepare('SELECT id, created_at, description FROM snapshots ORDER BY id DESC').all();
    res.json({ snapshots: snaps });
});
api.post('/api/snapshots', (req, res) => {
    const data = window.db.db.export();
    db.prepare('INSERT INTO snapshots (description, data) VALUES (?, ?)').run(req.body.description, data);
    res.json({ message: 'Snapshot created' });
});
api.post('/api/snapshots/:id/restore', (req, res) => {
    const snap = db.prepare('SELECT data FROM snapshots WHERE id = ?').get(req.params.id);
    if(snap) {
        // We need to reload the DB object entirely.
        // This is tricky because db-wrapper holds the reference.
        // We will just re-init the db wrapper with this data.
        const SQL = window.SQL; // Assuming we can access SQL class
        window.db.db = new SQL.Database(new Uint8Array(snap.data));
        window.db.save();
        res.json({ message: 'Restored' });
    } else {
        res.status(404).json({ error: 'Snapshot not found' });
    }
});

window.api = api;

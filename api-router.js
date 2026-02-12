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
    res.json({ user: { id: 1, username: 'admin', role: 'admin', token: 'mock-token-' + Math.random().toString(36).slice(2) } });
});
api.post('/api/logout', (req, res) => res.json({ message: 'Logged out' }));

// Users
api.get('/api/users/:userId/sites', (req, res) => {
    const sites = window.db.prepare(`
        SELECT s.id, s.name
        FROM sites s
        JOIN site_users su ON s.id = su.site_id
        WHERE su.user_id = ?
    `).all(req.params.userId);
    res.json({ sites });
});

api.get('/api/users', (req, res) => {
    const { includeSettings } = req.query;
    if (includeSettings) {
        const users = window.db.prepare('SELECT * FROM users ORDER BY username ASC').all();
        const settings = window.db.prepare('SELECT * FROM user_settings').all();
        const settingsMap = new Map();
        settings.forEach(s => settingsMap.set(s.user_id, s));

        users.forEach(u => {
            u.settings = settingsMap.get(u.id) || {};
        });
        return res.json({ users });
    }
    const users = window.db.prepare('SELECT * FROM users ORDER BY username ASC').all();
    res.json({ users });
});
api.post('/api/users', (req, res) => {
    const { username, role } = req.body;
    try {
        const result = window.db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run(username, role);
        res.json({ message: 'User created', id: result.lastInsertRowid });
    } catch(e) { res.status(500).json({error: e.message}); }
});
api.post('/api/users/bulk', (req, res) => {
    const { users } = req.body; // Array of {username, role}
    const added = [];
    const failed = [];

    window.db.transaction(() => {
        const checkStmt = window.db.prepare('SELECT 1 FROM users WHERE username = ?');
        const insertStmt = window.db.prepare('INSERT INTO users (username, role) VALUES (?, ?)');

        users.forEach(u => {
            const { username, role } = u;
            if(!username) {
                failed.push({ item: '(empty)', reason: 'Missing username' });
                return;
            }

            const exists = checkStmt.get(username);
            if(exists) {
                failed.push({ item: username, reason: 'Already exists' });
            } else {
                try {
                    insertStmt.run(username, role || 'user');
                    added.push(username);
                } catch(e) {
                    failed.push({ item: username, reason: e.message });
                }
            }
        });
    })();
    res.json({ added, failed });
});
api.delete('/api/users/:id', (req, res) => {
    window.db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: 'User deleted' });
});

// User Settings
api.get('/api/users/:id/settings', (req, res) => {
    const settings = window.db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.params.id);
    res.json({ settings: settings || {} });
});
api.put('/api/users/:id/settings', (req, res) => {
    const { id } = req.params;
    const s = req.body;
    // Upsert
    const existing = window.db.prepare('SELECT 1 FROM user_settings WHERE user_id = ?').get(id);
    if(existing) {
        window.db.prepare(`
            UPDATE user_settings SET
            max_consecutive_shifts=?, min_days_off=?, night_preference=?, target_shifts=?, target_shifts_variance=?, preferred_block_size=?, shift_ranking=?, availability_rules=?, no_preference=?
            WHERE user_id=?
        `).run(s.max_consecutive_shifts, s.min_days_off, s.night_preference, s.target_shifts, s.target_shifts_variance, s.preferred_block_size, s.shift_ranking, s.availability_rules, s.no_preference ? 1 : 0, id);
    } else {
        window.db.prepare(`
            INSERT INTO user_settings (user_id, max_consecutive_shifts, min_days_off, night_preference, target_shifts, target_shifts_variance, preferred_block_size, shift_ranking, availability_rules, no_preference)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(id, s.max_consecutive_shifts, s.min_days_off, s.night_preference, s.target_shifts, s.target_shifts_variance, s.preferred_block_size, s.shift_ranking, s.availability_rules || '{}', s.no_preference ? 1 : 0);
    }
    res.json({ message: 'Settings saved' });
});

api.put('/api/users/bulk-settings', (req, res) => {
    const updates = req.body; // Array of { userId, settings: { ... } }

    try {
        window.db.transaction(() => {
            const getStmt = window.db.prepare('SELECT * FROM user_settings WHERE user_id = ?');
            const updateStmt = window.db.prepare(`
                UPDATE user_settings SET
                max_consecutive_shifts=?, min_days_off=?, night_preference=?, target_shifts=?, target_shifts_variance=?, preferred_block_size=?, shift_ranking=?, availability_rules=?, no_preference=?
                WHERE user_id=?
            `);
            const insertStmt = window.db.prepare(`
                INSERT INTO user_settings (user_id, max_consecutive_shifts, min_days_off, night_preference, target_shifts, target_shifts_variance, preferred_block_size, shift_ranking, availability_rules, no_preference)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            `);

            updates.forEach(u => {
                const userId = u.userId;
                const newS = u.settings || {};
                const existing = getStmt.get(userId);

                // Defaults
                const defaults = {
                    max_consecutive_shifts: 5,
                    min_days_off: 2,
                    night_preference: 1.0,
                    target_shifts: 8,
                    target_shifts_variance: 2,
                    preferred_block_size: 3,
                    shift_ranking: '[]',
                    availability_rules: '{}',
                    no_preference: 0
                };

                // Merge logic
                // If existing, start with it. If not, start with defaults.
                const merged = existing ? { ...existing } : { ...defaults };

                // Override with new values if present
                // We map specific keys to ensure safety and mapping
                const keys = ['max_consecutive_shifts', 'min_days_off', 'night_preference', 'target_shifts', 'target_shifts_variance', 'preferred_block_size', 'shift_ranking', 'availability_rules', 'no_preference'];

                keys.forEach(k => {
                    if (newS[k] !== undefined && newS[k] !== null) {
                        merged[k] = newS[k];
                    }
                });

                // Prepare params
                const p = [
                    merged.max_consecutive_shifts,
                    merged.min_days_off,
                    merged.night_preference,
                    merged.target_shifts,
                    merged.target_shifts_variance,
                    merged.preferred_block_size,
                    typeof merged.shift_ranking === 'string' ? merged.shift_ranking : JSON.stringify(merged.shift_ranking || []),
                    typeof merged.availability_rules === 'string' ? merged.availability_rules : JSON.stringify(merged.availability_rules || {}),
                    merged.no_preference ? 1 : 0
                ];

                if (existing) {
                    updateStmt.run(...p, userId);
                } else {
                    insertStmt.run(userId, ...p);
                }
            });
        })();
        res.json({ message: 'Bulk settings updated' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Global Settings
api.get('/api/settings/global', (req, res) => {
    const rows = window.db.prepare('SELECT * FROM global_settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json({ settings });
});

api.put('/api/settings/global', (req, res) => {
    const s = req.body;
    window.db.transaction(() => {
        const stmt = window.db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
        for(const k in s) {
            stmt.run(k, String(s[k]));
        }
    })();
    res.json({ message: 'Global settings saved' });
});

// Sites
api.get('/api/sites', (req, res) => {
    const sites = window.db.prepare('SELECT * FROM sites').all();
    res.json({ sites });
});
api.post('/api/sites', (req, res) => {
    const { name, description } = req.body;
    const result = window.db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run(name, description || '');
    // Link admin to site automatically so they show up in schedule
    window.db.prepare('INSERT INTO site_users (site_id, user_id) VALUES (?, 1)').run(result.lastInsertRowid);
    res.json({ message: 'Site created', id: result.lastInsertRowid });
});
api.post('/api/sites/bulk', (req, res) => {
    const { sites } = req.body; // Array of {name}
    const added = [];
    const failed = [];

    window.db.transaction(() => {
        const checkStmt = window.db.prepare('SELECT 1 FROM sites WHERE name = ?');
        const insertStmt = window.db.prepare('INSERT INTO sites (name, description) VALUES (?, "")');
        const linkStmt = window.db.prepare('INSERT INTO site_users (site_id, user_id) VALUES (?, 1)'); // Link admin

        sites.forEach(s => {
            const name = s.name;
            if(!name) {
                failed.push({ item: '(empty)', reason: 'Missing site name' });
                return;
            }

            const exists = checkStmt.get(name);
            if(exists) {
                failed.push({ item: name, reason: 'Already exists' });
            } else {
                try {
                    const result = insertStmt.run(name);
                    linkStmt.run(result.lastInsertRowid);
                    added.push(name);
                } catch(e) {
                    failed.push({ item: name, reason: e.message });
                }
            }
        });
    })();
    res.json({ added, failed });
});
api.delete('/api/sites/:id', (req, res) => {
    window.db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
});

api.put('/api/sites/:id', (req, res) => {
    const { id } = req.params;
    const { name, description, weekend_start_day, weekend_start_time, weekend_end_day, weekend_end_time } = req.body;

    // Use COALESCE to keep existing values if not provided (undefined -> null)
    const stmt = window.db.prepare(`
        UPDATE sites
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            weekend_start_day = COALESCE(?, weekend_start_day),
            weekend_start_time = COALESCE(?, weekend_start_time),
            weekend_end_day = COALESCE(?, weekend_end_day),
            weekend_end_time = COALESCE(?, weekend_end_time)
        WHERE id = ?
    `);

    stmt.run(name, description, weekend_start_day, weekend_start_time, weekend_end_day, weekend_end_time, id);
    res.json({ message: 'Site updated' });
});

// Shifts
api.get('/api/sites/:siteId/shifts', (req, res) => {
    const shifts = window.db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(req.params.siteId);
    res.json({ shifts });
});
api.post('/api/sites/:siteId/shifts', (req, res) => {
    const { name, start_time, end_time, required_staff, days_of_week, is_weekend } = req.body;
    const days = days_of_week || '0,1,2,3,4,5,6';
    const weekend = is_weekend ? 1 : 0;
    const staff = parseInt(required_staff) || 1;
    const sId = parseInt(req.params.siteId);

    window.db.prepare('INSERT INTO shifts (site_id, name, start_time, end_time, required_staff, days_of_week, is_weekend) VALUES (?,?,?,?,?,?,?)')
      .run(sId, name, start_time, end_time, staff, days, weekend);
    res.json({ message: 'Shift created' });
});
api.delete('/api/shifts/:id', (req, res) => {
    window.db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
});

// Schedule
api.get('/api/schedule', (req, res) => {
    const { siteId, startDate, days, month, year } = req.query;

    let startStr, endStr;

    if (startDate && days) {
        startStr = startDate;
        const start = new Date(startDate);
        const end = new Date(start);
        end.setDate(start.getDate() + parseInt(days) - 1);
        // Use shared helper
        endStr = window.toDateStr(end);
    } else if (month && year) {
        startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
        endStr = `${year}-${month.toString().padStart(2, '0')}-31`;
    } else {
        return res.status(400).json({ error: 'Missing date parameters' });
    }

    const assignments = window.db.prepare(`
        SELECT a.date, a.status, a.is_locked, a.shift_id, s.name as shift_name, u.username, u.id as user_id
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        JOIN users u ON a.user_id = u.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
        ORDER BY a.date ASC, u.username ASC
    `).all(siteId, startStr, endStr);

    const requests = window.db.prepare(`
        SELECT r.date, r.type, r.user_id, r.shift_id
        FROM requests r
        WHERE r.site_id = ? AND r.date BETWEEN ? AND ?
    `).all(siteId, startStr, endStr);

    res.json({ schedule: assignments, requests });
});

api.post('/api/schedule/lock-all', (req, res) => {
    const { siteId, startDate, endDate, isLocked } = req.body;
    window.db.prepare(`
        UPDATE assignments
        SET is_locked = ?
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).run(isLocked ? 1 : 0, siteId, startDate, endDate);
    res.json({ message: isLocked ? 'Locked all' : 'Unlocked all' });
});

api.post('/api/schedule/clear', (req, res) => {
    const { siteId, startDate, endDate } = req.body;
    // Clear ALL assignments in the range
    window.db.prepare(`
        DELETE FROM assignments
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).run(siteId, startDate, endDate);
    res.json({ message: 'Schedule cleared' });
});

api.put('/api/schedule/assignment', (req, res) => {
    const { siteId, date, userId, shiftId, isLocked } = req.body;
    const sId = String(shiftId || '').trim();

    // Default to locked (1) if not specified, preserving old behavior for manual moves
    const lockedVal = (isLocked === undefined) ? 1 : (isLocked ? 1 : 0);

    window.db.transaction(() => {
        window.db.prepare('DELETE FROM assignments WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);
        window.db.prepare('DELETE FROM requests WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);

        if (sId.toUpperCase() === 'OFF') {
            window.db.prepare('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)').run(siteId, date, userId, 'off');
        } else if (sId !== '') {
            window.db.prepare(`
                INSERT INTO assignments (site_id, date, user_id, shift_id, is_locked, status)
                VALUES (?, ?, ?, ?, ?, 'draft')
            `).run(siteId, date, userId, sId, lockedVal);
        }
    })();
    res.json({ message: 'Updated' });
});

api.post('/api/schedule/generate', async (req, res) => {
    try {
        const { siteId, startDate, days, force, iterations, onProgress } = req.body;
        // Call the global function exposed by scheduler.js
        const result = await window.generateSchedule({
            siteId,
            startDate,
            days: parseInt(days),
            force: !!force,
            iterations: iterations ? parseInt(iterations) : undefined,
            onProgress
        });

        // Auto-save snapshot
        try {
            const data = window.db.db.export();
            const desc = `Auto-save: ${new Date().toLocaleString()}`;
            window.db.prepare('INSERT INTO snapshots (description, data) VALUES (?, ?)').run(desc, data);

            // Cleanup old snapshots (keep last 20)
            const countRes = window.db.prepare('SELECT COUNT(*) as count FROM snapshots').get();
            if (countRes.count > 20) {
                // Delete oldest, keeping 20
                window.db.prepare(`
                    DELETE FROM snapshots
                    WHERE id NOT IN (
                        SELECT id FROM snapshots ORDER BY id DESC LIMIT 20
                    )
                `).run();
            }
        } catch (e) {
            console.error("Auto-save failed:", e);
        }

        res.json({ message: 'Generated', assignments: result.assignments, conflictReport: result.conflictReport });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

api.get('/api/sites/:siteId/users', (req, res) => {
    const users = window.db.prepare(`
        SELECT u.id, u.username, u.role, su.category_id, c.name as category_name, c.color as category_color, c.is_manual
        FROM users u
        JOIN site_users su ON u.id = su.user_id
        LEFT JOIN user_categories c ON su.category_id = c.id
        WHERE su.site_id = ?
        ORDER BY u.username ASC
    `).all(req.params.siteId);
    res.json({ users });
});

// Categories
api.get('/api/sites/:siteId/categories', (req, res) => {
    const cats = window.db.prepare('SELECT * FROM user_categories WHERE site_id = ? ORDER BY priority ASC').all(req.params.siteId);
    res.json({ categories: cats });
});

api.post('/api/sites/:siteId/categories', (req, res) => {
    const { name, priority, color, is_manual } = req.body;
    window.db.prepare('INSERT INTO user_categories (site_id, name, priority, color, is_manual) VALUES (?, ?, ?, ?, ?)').run(req.params.siteId, name, priority, color || '#ffffff', is_manual ? 1 : 0);
    res.json({ message: 'Category created' });
});

api.put('/api/categories/:id', (req, res) => {
    const { name, priority, color, is_manual } = req.body;
    window.db.prepare('UPDATE user_categories SET name=?, priority=?, color=?, is_manual=? WHERE id=?').run(name, priority, color, is_manual ? 1 : 0, req.params.id);
    res.json({ message: 'Category updated' });
});

api.delete('/api/categories/:id', (req, res) => {
    window.db.prepare('DELETE FROM user_categories WHERE id=?').run(req.params.id);
    res.json({ message: 'Category deleted' });
});

// Update User Category
api.put('/api/sites/:siteId/user-category', (req, res) => {
    const { userId, categoryId } = req.body;
    window.db.prepare('UPDATE site_users SET category_id = ? WHERE site_id = ? AND user_id = ?')
      .run(categoryId || null, req.params.siteId, userId);
    res.json({ message: 'User category updated' });
});

api.put('/api/sites/:siteId/users', (req, res) => {
    const { userIds } = req.body; // Array of user IDs
    const siteId = req.params.siteId;

    try {
        window.db.transaction(() => {
            // Smart update: Only add/remove changes to preserve category_id for existing users
            const currentUsers = window.db.prepare('SELECT user_id FROM site_users WHERE site_id = ?').all(siteId).map(u => u.user_id);
            const toRemove = currentUsers.filter(uid => !userIds.includes(uid));
            const toAdd = userIds.filter(uid => !currentUsers.includes(uid));

            if (toRemove.length > 0) {
                const delStmt = window.db.prepare('DELETE FROM site_users WHERE site_id = ? AND user_id = ?');
                toRemove.forEach(uid => delStmt.run(siteId, uid));
            }

            if (toAdd.length > 0) {
                const addStmt = window.db.prepare('INSERT INTO site_users (site_id, user_id) VALUES (?, ?)');
                toAdd.forEach(uid => addStmt.run(siteId, uid));
            }
        })();
        res.json({ message: 'Site users updated' });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Requests
api.get('/api/requests', (req, res) => {
    const { siteId, month, year } = req.query;
    const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;
    const reqs = window.db.prepare('SELECT * FROM requests WHERE site_id=? AND date BETWEEN ? AND ?').all(siteId, startStr, endStr);
    res.json({ requests: reqs });
});

api.post('/api/requests', (req, res) => {
    const { siteId, requests, month, year, userId } = req.body;
    // Validate userId
    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }

    window.db.transaction(() => {
        requests.forEach(r => {
            window.db.prepare('DELETE FROM requests WHERE site_id=? AND user_id=? AND date=?').run(siteId, userId, r.date);
            if(r.type !== 'none') {
                window.db.prepare('INSERT INTO requests (site_id, user_id, date, type, shift_id) VALUES (?,?,?,?,?)').run(siteId, userId, r.date, r.type, r.shiftId || null);
            }
        });
    })();
    res.json({ message: 'Requests saved' });
});


// Snapshots
api.get('/api/snapshots', (req, res) => {
    const snaps = window.db.prepare('SELECT id, created_at, description FROM snapshots ORDER BY id DESC').all();
    res.json({ snapshots: snaps });
});
api.post('/api/snapshots', (req, res) => {
    const data = window.db.db.export();
    window.db.prepare('INSERT INTO snapshots (description, data) VALUES (?, ?)').run(req.body.description, data);
    res.json({ message: 'Snapshot created' });
});
api.post('/api/snapshots/:id/restore', (req, res) => {
    const snap = window.db.prepare('SELECT data FROM snapshots WHERE id = ?').get(req.params.id);
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

if (typeof module !== 'undefined') {
    module.exports = api;
}

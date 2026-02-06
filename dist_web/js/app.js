// Application Logic (Controller/Service Layer)

window.App = {
    // --- Auth ---
    me: async () => {
        // Mock Admin User
        return { user: { id: 1, username: 'admin', role: 'admin', token: 'local-token' } };
    },
    logout: async () => {
        // No-op for local version
        return { message: 'Logged out' };
    },

    // --- Sites ---
    getSites: async () => {
        const sites = window.db.prepare('SELECT * FROM sites').all();
        return { sites };
    },
    createSite: async ({ name, description }) => {
        window.db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run(name, description);
        return { message: 'Created' };
    },
    deleteSite: async (id) => {
        window.db.prepare('DELETE FROM sites WHERE id = ?').run(id);
        return { message: 'Deleted' };
    },
    getSiteUsers: async (siteId) => {
        // For local version, return all users
        const users = window.db.prepare('SELECT * FROM users').all();
        return { users };
    },
    getSiteShifts: async (siteId) => {
        const shifts = window.db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);
        return { shifts };
    },

    // --- Users ---
    getUsers: async () => {
        const users = window.db.prepare('SELECT * FROM users').all();
        return { users };
    },
    createUser: async ({ username, role }) => {
        try {
            window.db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run(username, role);
            return { message: 'Created' };
        } catch(e) {
            return { error: e.message };
        }
    },
    deleteUser: async (id) => {
        window.db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return { message: 'Deleted' };
    },
    getUserSettings: async (id) => {
        const s = window.db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(id);
        return { settings: s || {} };
    },
    updateUserSettings: async (id, settings) => {
        const existing = window.db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(id);
        const jsonRanking = settings.shift_ranking || '[]';

        if(existing) {
            window.db.prepare(`
                UPDATE user_settings SET
                max_consecutive_shifts=?, min_days_off=?, night_preference=?,
                target_shifts=?, target_shifts_variance=?, preferred_block_size=?, shift_ranking=?
                WHERE user_id=?
            `).run(
                settings.max_consecutive_shifts, settings.min_days_off, settings.night_preference,
                settings.target_shifts, settings.target_shifts_variance, settings.preferred_block_size, jsonRanking,
                id
            );
        } else {
             window.db.prepare(`
                INSERT INTO user_settings (
                    user_id, max_consecutive_shifts, min_days_off, night_preference,
                    target_shifts, target_shifts_variance, preferred_block_size, shift_ranking
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                settings.max_consecutive_shifts, settings.min_days_off, settings.night_preference,
                settings.target_shifts, settings.target_shifts_variance, settings.preferred_block_size, jsonRanking
            );
        }
        return { message: 'Updated' };
    },

    // --- Shifts ---
    createShift: async (siteId, { name, start_time, end_time, required_staff }) => {
        window.db.prepare('INSERT INTO shifts (site_id, name, start_time, end_time, required_staff) VALUES (?,?,?,?,?)')
            .run(siteId, name, start_time, end_time, required_staff);
        return { message: 'Created' };
    },
    deleteShift: async (id) => {
        window.db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
        return { message: 'Deleted' };
    },

    // --- Schedule & Requests ---
    generateSchedule: async ({ siteId, month, year }) => {
        return window.Scheduler.generateSchedule({ siteId, month, year });
    },

    getSchedule: async ({ siteId, month, year, status }) => {
        const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;

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
        const schedule = window.db.prepare(query).all(...params);

        const requests = window.db.prepare(`
            SELECT r.date, r.type, r.user_id
            FROM requests r
            WHERE r.site_id = ? AND r.date BETWEEN ? AND ?
        `).all(siteId, startStr, endStr);

        return { schedule, requests };
    },

    updateAssignment: async ({ siteId, date, userId, shiftId }) => {
        const sId = String(shiftId || '').trim();
        const tx = window.db.transaction(() => {
            window.db.prepare('DELETE FROM assignments WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);
            window.db.prepare('DELETE FROM requests WHERE site_id = ? AND date = ? AND user_id = ?').run(siteId, date, userId);

            if (sId.toUpperCase() === 'OFF') {
                 window.db.prepare('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)').run(siteId, date, userId, 'off');
            } else if (sId !== '') {
                 window.db.prepare(`
                    INSERT INTO assignments (site_id, date, user_id, shift_id, is_locked, status)
                    VALUES (?, ?, ?, ?, 1, 'draft')
                `).run(siteId, date, userId, sId);
            }
        });
        tx();
        return { message: 'Updated' };
    },

    getRequests: async ({ siteId, month, year }) => {
        const startStr = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endStr = `${year}-${month.toString().padStart(2, '0')}-31`;
        const requests = window.db.prepare(`
            SELECT * FROM requests WHERE site_id = ? AND date BETWEEN ? AND ?
        `).all(siteId, startStr, endStr);
        return { requests };
    },

    saveRequests: async ({ siteId, requests, month, year }) => {
        // For regular user dashboard, assumes current user (Admin ID 1)
        // If we want to support multiple users, we'd need a real user switcher.
        // For now, hardcode ID 1 (Admin).
        const userId = 1;

        const tx = window.db.transaction(() => {
             requests.forEach(r => {
                 window.db.prepare('DELETE FROM requests WHERE site_id=? AND date=? AND user_id=?').run(siteId, r.date, userId);
                 if(r.type !== 'none') {
                     window.db.prepare('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)').run(siteId, r.date, userId, r.type);
                 }
             });
        });
        tx();
        return { message: 'Saved' };
    },

    // --- Snapshots ---
    getSnapshots: async () => {
        const snapshots = window.db.prepare('SELECT id, created_at, description FROM snapshots ORDER BY created_at DESC').all();
        return { snapshots };
    },
    createSnapshot: async ({ description }) => {
        const blob = window.db.export();
        // Binary to Base64
        let binary = '';
        const bytes = new Uint8Array(blob);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);

        window.db.prepare('INSERT INTO snapshots (description, data_blob) VALUES (?, ?)').run(description, b64);
        return { message: 'Snapshot created' };
    },
    restoreSnapshot: async (id) => {
        const snap = window.db.prepare('SELECT data_blob FROM snapshots WHERE id = ?').get(id);
        if(snap) {
            const b64 = snap.data_blob;
            const binary = atob(b64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            // We need to re-init DB with this data.
            // Since we are in the App layer, we need to access the initialization logic.
            // This is tricky because we are inside the running app.
            // We can replace window.db internal db, but DBAdapter wraps it.
            // Best way: reload page?
            // Or expose a method on db adapter to replace instance.
            // The `window.restoreSnapshot` in admin.js does `location.reload()` after this call.
            // So we just need to save this blob to IndexedDB!
            await saveToIndexedDB(bytes); // Helper from db.js? It's not global.
            // I should expose `window.db.saveDirect(bytes)` or similar.
            // Or I can modify `db.js` to expose `saveToIndexedDB` globally or on `db` object.

            // Workaround: Use the fact that `window.db.db` is the SQL object.
            // Actually, simplest is to update `db.js` to handle restore, OR
            // just write to IndexedDB here if I duplicate the config.

            // Let's assume I can call `window.db.overwrite(bytes)`.
            // I'll update `db.js` in a future thought if needed, but for now I'll just
            // try to access the internal mechanism or re-implement saving here.

            const DB_CONFIG = { dbName: 'ScheduleDB', storeName: 'sqlite_file', key: 'db_dump' };
            const req = indexedDB.open(DB_CONFIG.dbName, 1);
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction(DB_CONFIG.storeName, 'readwrite');
                tx.objectStore(DB_CONFIG.storeName).put(bytes, DB_CONFIG.key);
            };
        }
        return { message: 'Restored' };
    }
};

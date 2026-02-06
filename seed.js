const db = require('./src/db');
const crypto = require('crypto');

const seed = async () => {
    try {
        console.log('Seeding database...');

        // 1. Create Default Site
        let site = db.prepare('SELECT * FROM sites WHERE name = ?').get('Main Hospital');
        if (!site) {
            const info = db.prepare('INSERT INTO sites (name, description) VALUES (?, ?)').run('Main Hospital', 'General Ward');
            site = { id: info.lastInsertRowid };
            console.log('Created Site: Main Hospital');
        }

        // 2. Create Shifts
        const shiftNames = [
            { name: 'Day', start: '07:00', end: '15:00' },
            { name: 'Swing', start: '15:00', end: '23:00' },
            { name: 'Night', start: '23:00', end: '07:00' }
        ];

        for (const s of shiftNames) {
            const exists = db.prepare('SELECT * FROM shifts WHERE site_id = ? AND name = ?').get(site.id, s.name);
            if (!exists) {
                db.prepare('INSERT INTO shifts (site_id, name, start_time, end_time, required_staff) VALUES (?, ?, ?, ?, ?)')
                  .run(site.id, s.name, s.start, s.end, 1);
                console.log(`Created Shift: ${s.name}`);
            }
        }

        // 3. Create Users
        const users = [
            { username: 'admin', role: 'admin' },
            { username: 'Alice', role: 'user' },
            { username: 'Bob', role: 'user' },
            { username: 'Charlie', role: 'user' },
            { username: 'David', role: 'user' },
            { username: 'Eve', role: 'user' }
        ];

        for (const u of users) {
            let user = db.prepare('SELECT * FROM users WHERE username = ?').get(u.username);
            if (!user) {
                const token = crypto.randomUUID();
                const info = db.prepare('INSERT INTO users (username, role, token, default_site_id) VALUES (?, ?, ?, ?)').run(u.username, u.role, token, site.id);
                user = { id: info.lastInsertRowid };
                console.log(`Created User: ${u.username}`);
            }

            // Link to Site
            db.prepare('INSERT OR IGNORE INTO site_users (site_id, user_id) VALUES (?, ?)').run(site.id, user.id);

            // Default Settings
            db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(user.id);
        }

        console.log('Seeding complete.');

    } catch (error) {
        console.error('Error seeding database:', error);
    }
};

seed();

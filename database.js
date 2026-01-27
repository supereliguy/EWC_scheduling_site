const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const db = new Database('schedule.db', { verbose: console.log });

// Initialize tables
const initDb = () => {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user', -- 'admin' or 'user'
            token TEXT UNIQUE, -- Secure token for public feeds
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Sites table
    db.exec(`
        CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT
        )
    `);

    // Shifts table
    db.exec(`
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER NOT NULL,
            name TEXT NOT NULL, -- e.g. "Day", "Night"
            start_time TEXT NOT NULL, -- "HH:MM"
            end_time TEXT NOT NULL, -- "HH:MM"
            required_staff INTEGER DEFAULT 1,
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
        )
    `);

    // Requests table
    db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            site_id INTEGER NOT NULL,
            date TEXT NOT NULL, -- "YYYY-MM-DD"
            type TEXT NOT NULL, -- 'work', 'off'
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
            UNIQUE(user_id, site_id, date)
        )
    `);

    // Assignments table (The Schedule)
    db.exec(`
        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER NOT NULL,
            date TEXT NOT NULL, -- "YYYY-MM-DD"
            shift_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT DEFAULT 'draft', -- 'draft', 'published'
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
            FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(site_id, date, shift_id, user_id)
        )
    `);

    console.log('Database initialized.');
};

initDb();

module.exports = db;

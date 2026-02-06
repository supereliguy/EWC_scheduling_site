const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'schedule.db');
console.log(`Initializing Database at: ${dbPath}`);

const db = new Database(dbPath, { verbose: console.log });

// Initialize tables
const initDb = () => {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            role TEXT DEFAULT 'user', -- 'admin' or 'user'
            token TEXT UNIQUE, -- Secure token for public feeds
            default_site_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(default_site_id) REFERENCES sites(id) ON DELETE SET NULL
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

    // Site Users (Many-to-Many)
    db.exec(`
        CREATE TABLE IF NOT EXISTS site_users (
            site_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            PRIMARY KEY(site_id, user_id),
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
            is_locked BOOLEAN DEFAULT 0, -- 1 if manually locked/pre-assigned
            status TEXT DEFAULT 'draft', -- 'draft', 'published'
            FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
            FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(site_id, date, shift_id, user_id)
        )
    `);

    // User Settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            max_consecutive_shifts INTEGER DEFAULT 5,
            min_days_off INTEGER DEFAULT 2,
            night_preference REAL DEFAULT 1.0,
            target_shifts INTEGER DEFAULT 20,
            target_shifts_variance INTEGER DEFAULT 2,
            preferred_block_size INTEGER DEFAULT 3,
            shift_ranking TEXT DEFAULT '[]', -- JSON string array of shift names
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Snapshots table
    db.exec(`
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            description TEXT,
            data_blob TEXT NOT NULL -- JSON dump of the DB state
        )
    `);

    console.log('Database initialized.');
};

initDb();

module.exports = db;

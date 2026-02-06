// Database Adapter for sql.js to mimic better-sqlite3

const DB_CONFIG = {
    dbName: 'ScheduleDB',
    storeName: 'sqlite_file',
    key: 'db_dump'
};

class DBAdapter {
    constructor(db) {
        this.db = db;
    }

    exec(sql) {
        this.db.exec(sql);
        this.save();
    }

    prepare(sql) {
        // sql.js prepare returns a statement
        const stmt = this.db.prepare(sql);
        const self = this;

        return {
            all: function(...args) {
                try {
                    // better-sqlite3 accepts varargs or array
                    // sql.js bind accepts array
                    const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
                    stmt.bind(params);
                    const rows = [];
                    while(stmt.step()) {
                        rows.push(stmt.getAsObject());
                    }
                    return rows;
                } catch(e) {
                    console.error("SQL Error in all():", e, sql);
                    throw e;
                } finally {
                    stmt.reset();
                }
            },
            run: function(...args) {
                try {
                    const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
                    stmt.bind(params);
                    stmt.step();

                    const changes = self.db.getRowsModified();
                    // Get last insert ID
                    let lastInsertRowid = 0;
                    try {
                        const res = self.db.exec("SELECT last_insert_rowid()");
                        if (res.length > 0 && res[0].values.length > 0) {
                            lastInsertRowid = res[0].values[0][0];
                        }
                    } catch(e) { /* ignore */ }

                    self.save();
                    return { changes, lastInsertRowid };
                } catch(e) {
                    console.error("SQL Error in run():", e, sql);
                    throw e;
                } finally {
                    stmt.reset();
                }
            },
            get: function(...args) {
                try {
                    const params = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
                    stmt.bind(params);
                    if(stmt.step()) {
                        return stmt.getAsObject();
                    }
                    return undefined;
                } catch(e) {
                    console.error("SQL Error in get():", e, sql);
                    throw e;
                } finally {
                    stmt.reset();
                }
            }
        };
    }

    transaction(fn) {
        return (...args) => {
            this.db.exec("BEGIN");
            try {
                const res = fn(...args);
                this.db.exec("COMMIT");
                this.save();
                return res;
            } catch(e) {
                console.error("Transaction Error:", e);
                this.db.exec("ROLLBACK");
                throw e;
            }
        };
    }

    export() {
        return this.db.export();
    }

    save() {
        if(this.saving) return;
        this.saving = true;
        // Debounce?
        setTimeout(() => {
            const binary = this.db.export();
            saveToIndexedDB(binary).then(() => {
                this.saving = false;
                console.log("DB Saved");
            });
        }, 100);
    }
}

// IndexedDB Helper
function saveToIndexedDB(data) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_CONFIG.dbName, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if(!db.objectStoreNames.contains(DB_CONFIG.storeName)) {
                db.createObjectStore(DB_CONFIG.storeName);
            }
        };
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(DB_CONFIG.storeName, 'readwrite');
            tx.objectStore(DB_CONFIG.storeName).put(data, DB_CONFIG.key);
            tx.oncomplete = () => resolve();
            tx.onerror = (err) => reject(err);
        };
        req.onerror = (e) => reject(e);
    });
}

function loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_CONFIG.dbName, 1);
        req.onupgradeneeded = (e) => {
             const db = e.target.result;
             db.createObjectStore(DB_CONFIG.storeName);
        };
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(DB_CONFIG.storeName, 'readonly');
            const getReq = tx.objectStore(DB_CONFIG.storeName).get(DB_CONFIG.key);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null); // Return null on error (first run)
    });
}

// Schemas
const SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'user',
        token TEXT UNIQUE,
        default_site_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(default_site_id) REFERENCES sites(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT
    );

    CREATE TABLE IF NOT EXISTS site_users (
        site_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY(site_id, user_id),
        FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        required_staff INTEGER DEFAULT 1,
        FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        site_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
        UNIQUE(user_id, site_id, date)
    );

    CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        shift_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        is_locked BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'draft',
        FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(site_id, date, shift_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        max_consecutive_shifts INTEGER DEFAULT 5,
        min_days_off INTEGER DEFAULT 2,
        night_preference REAL DEFAULT 1.0,
        target_shifts INTEGER DEFAULT 20,
        target_shifts_variance INTEGER DEFAULT 2,
        preferred_block_size INTEGER DEFAULT 3,
        shift_ranking TEXT DEFAULT '[]',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`;

window.initAppDB = async () => {
    // Load sql.js
    const SQL = await initSqlJs({
        locateFile: file => `lib/${file}`
    });

    // Check storage
    const storedData = await loadFromIndexedDB();
    let db;
    if (storedData) {
        db = new SQL.Database(new Uint8Array(storedData));
        console.log("Loaded DB from storage");
    } else {
        db = new SQL.Database();
        console.log("Created new DB");
        db.run(SCHEMA);

        // Seed Default Admin
        db.run(`INSERT INTO users (username, role) VALUES ('admin', 'admin')`);
    }

    const adapter = new DBAdapter(db);
    window.db = adapter; // Expose globally for scheduler
    return adapter;
};

window.importDB = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            const SQL = await initSqlJs({ locateFile: file => `lib/${file}` });
            const Uints = new Uint8Array(reader.result);
            const db = new SQL.Database(Uints);
            window.db = new DBAdapter(db);
            window.db.save(); // Save immediately
            resolve();
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

window.exportDB = () => {
    const binary = window.db.export();
    const blob = new Blob([binary], {type: 'application/x-sqlite3'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `schedule_backup_${new Date().toISOString().split('T')[0]}.sqlite`;
    a.click();
};

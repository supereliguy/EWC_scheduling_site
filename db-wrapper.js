
class DBWrapper {
    constructor() {
        this.db = null;
        this.inTransaction = false;
    }

    async init() {
        if (this.db) return;

        // Load SQL.js
        if (!window.initSqlJs) {
            throw new Error("SQL.js not loaded");
        }
        const SQL = await window.initSqlJs({
            // Locate the wasm file. We assume it's in the same directory.
            locateFile: file => `./${file}`
        });

        // Try to load from localStorage/IndexedDB
        const savedData = await this.loadFromStorage();
        if (savedData) {
            this.db = new SQL.Database(new Uint8Array(savedData));
        } else {
            this.db = new SQL.Database();
            this.seed();
        }

        // Auto-save on modification could be tricky with sql.js since it's in-memory.
        // We will implement an explicit save function that we call after write ops.
    }

    seed() {
        // Schema from original seed.js
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                role TEXT DEFAULT 'user',
                token TEXT
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
            CREATE TABLE IF NOT EXISTS sites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                description TEXT
            );
            CREATE TABLE IF NOT EXISTS shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id INTEGER,
                name TEXT,
                start_time TEXT,
                end_time TEXT,
                required_staff INTEGER DEFAULT 1,
                FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id INTEGER,
                date TEXT,
                shift_id INTEGER,
                user_id INTEGER,
                status TEXT DEFAULT 'draft',
                is_locked INTEGER DEFAULT 0,
                FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                FOREIGN KEY(shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                site_id INTEGER,
                user_id INTEGER,
                date TEXT,
                type TEXT,
                reason TEXT,
                FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS site_users (
                site_id INTEGER,
                user_id INTEGER,
                PRIMARY KEY (site_id, user_id),
                FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS global_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                description TEXT,
                data BLOB
            );
        `);

        // Seed Global Settings
        const globalCount = this.db.exec("SELECT COUNT(*) FROM global_settings")[0].values[0][0];
        if (globalCount === 0) {
            const stmt = this.db.prepare("INSERT INTO global_settings (key, value) VALUES (?, ?)");
            stmt.run('max_consecutive_shifts', '5');
            stmt.run('min_days_off', '2');
            stmt.run('night_preference', '1.0');
            stmt.run('target_shifts', '20');
            stmt.run('target_shifts_variance', '2');
            stmt.run('preferred_block_size', '3');
        }

        // Default Admin
        // Check if admin exists
        const res = this.db.exec("SELECT * FROM users WHERE username='admin'");
        if (res.length === 0) {
            this.db.run("INSERT INTO users (username, role) VALUES ('admin', 'admin')");
        }
        this.save();
    }

    // --- Persistence ---

    async save() {
        const data = this.db.export();
        await this.saveToStorage(data);
    }

    async saveToStorage(data) {
        // Use IndexedDB for larger files
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("ScheduleAppDB", 1);
            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                db.createObjectStore("files");
            };
            request.onsuccess = function(event) {
                const db = event.target.result;
                const tx = db.transaction(["files"], "readwrite");
                const store = tx.objectStore("files");
                store.put(data, "sqliteFile");
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e);
            };
            request.onerror = (e) => reject(e);
        });
    }

    async loadFromStorage() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("ScheduleAppDB", 1);
            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                db.createObjectStore("files");
            };
            request.onsuccess = function(event) {
                const db = event.target.result;
                const tx = db.transaction(["files"], "readonly");
                const store = tx.objectStore("files");
                const getReq = store.get("sqliteFile");
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => resolve(null); // Not found is fine
            };
            request.onerror = () => resolve(null);
        });
    }

    // --- Better-SQLite3 Polyfill ---

    prepare(sql) {
        const stmt = this.db.prepare(sql);
        const wrapper = {
            all: (...params) => {
                stmt.bind(params);
                const res = [];
                while(stmt.step()) res.push(stmt.getAsObject());
                stmt.reset();
                return res;
            },
            run: (...params) => {
                stmt.run(params);
                // Last ID workaround?
                // SQL.js doesn't give lastInsertRowid easily on stmt.run()
                // We have to query it.
                const idRes = this.db.exec("SELECT last_insert_rowid()");
                const lastId = idRes[0].values[0][0];

                // Save after run?
                // For performance, we might want to manually save, but let's be safe.
                // However, doing this inside a loop is bad.
                // The `transaction` method handles batching.
                // We'll call save() manually in the API router for now, or debounce it.
                // For strict safety:
                if (!this.inTransaction) {
                    this.save();
                }

                return { lastInsertRowid: lastId, changes: this.db.getRowsModified() };
            },
            get: (...params) => {
                stmt.bind(params);
                let res = null;
                if(stmt.step()) res = stmt.getAsObject();
                stmt.reset();
                return res;
            }
        };
        return wrapper;
    }

    transaction(fn) {
        return (...args) => {
            this.inTransaction = true;
            this.db.exec("BEGIN TRANSACTION");
            try {
                const result = fn(...args);
                this.db.exec("COMMIT");
                this.inTransaction = false;
                this.save();
                return result;
            } catch (e) {
                this.db.exec("ROLLBACK");
                this.inTransaction = false;
                throw e;
            }
        };
    }

    exec(sql) {
        return this.db.exec(sql);
    }
}

// Export singleton
const db = new DBWrapper();
// We attach to window for global access in the browser since we are not using a bundler for everything
window.db = db;

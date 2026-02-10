
const initSqlJs = require('sql.js');

// Mock Browser Environment BEFORE requiring db-wrapper
global.window = {};
global.indexedDB = {
    open: jest.fn()
};

const { DBWrapper } = require('../db-wrapper.js');

describe('DB Import Security', () => {
    let dbWrapper;
    let SQL;

    beforeAll(async () => {
        // sql.js in Node usually finds the wasm file automatically if it's in the same folder as the js
        // But let's be safe.
        SQL = await initSqlJs();

        // Mock initSqlJs on window for DBWrapper
        // db-wrapper calls window.initSqlJs({ locateFile: ... })
        // We mock it to just return our already initialized SQL instance, ignoring config
        global.window.initSqlJs = () => Promise.resolve(SQL);
    });

    beforeEach(async () => {
        dbWrapper = new DBWrapper();
        // Mock storage to avoid IndexedDB errors
        dbWrapper.loadFromStorage = jest.fn().mockResolvedValue(null);
        dbWrapper.saveToStorage = jest.fn().mockResolvedValue(true);

        await dbWrapper.init();
    });

    // Helper to create a fresh DB instance (mimicking a file to import)
    const createTestDB = () => {
        const db = new SQL.Database();
        // Create minimal schema required to pass validation
        db.run("CREATE TABLE users (username TEXT, role TEXT)");
        db.run("CREATE TABLE sites (name TEXT)");
        db.run("CREATE TABLE shifts (name TEXT)");
        db.run("CREATE TABLE assignments (status TEXT)");
        db.run("CREATE TABLE requests (reason TEXT)");
        db.run("CREATE TABLE user_categories (name TEXT)");
        db.run("CREATE TABLE user_settings (availability_rules TEXT)");
        db.run("CREATE TABLE global_settings (value TEXT)");
        db.run("CREATE TABLE snapshots (description TEXT)");
        return db;
    };

    test('should validate a clean database', () => {
        const db = createTestDB();
        db.run("INSERT INTO users VALUES ('admin', 'admin')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).not.toThrow();
    });

    test('should reject database with missing tables', () => {
        const db = new SQL.Database();
        db.run("CREATE TABLE users (username TEXT)");
        // Missing other tables
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).toThrow(/Missing required tables/);
    });

    test('should reject XSS in users table (username)', () => {
        const db = createTestDB();
        db.run("INSERT INTO users VALUES ('<script>alert(1)</script>', 'user')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).toThrow(/Malicious content detected/);
        expect(() => dbWrapper.validateImport(data)).toThrow(/table 'users'/);
    });

    test('should reject XSS in users table (role)', () => {
        const db = createTestDB();
        db.run("INSERT INTO users VALUES ('user1', '<b>admin</b>')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).toThrow(/Malicious content detected/);
    });

    test('should reject XSS in JSON columns (user_settings)', () => {
        const db = createTestDB();
        const maliciousJson = JSON.stringify({ comment: "<img src=x>" });
        db.run("INSERT INTO user_settings (availability_rules) VALUES (?)", [maliciousJson]);

        const data = db.export();
        expect(() => dbWrapper.validateImport(data)).toThrow(/Malicious content detected/);
        expect(() => dbWrapper.validateImport(data)).toThrow(/table 'user_settings'/);
    });

    test('should reject XSS in global_settings', () => {
        const db = createTestDB();
        db.run("INSERT INTO global_settings (value) VALUES ('<iframe src=malware>')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).toThrow(/Malicious content detected/);
    });

    test('should allow safe special characters', () => {
        const db = createTestDB();
        db.run("INSERT INTO users VALUES ('O''Connor', 'user')");
        db.run("INSERT INTO sites VALUES ('Site #1 & 2')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).not.toThrow();
    });

    test('should reject XSS in requests', () => {
        const db = createTestDB();
        db.run("INSERT INTO requests (reason) VALUES ('My reason <script>')");
        const data = db.export();

        expect(() => dbWrapper.validateImport(data)).toThrow(/Malicious content detected/);
    });
});

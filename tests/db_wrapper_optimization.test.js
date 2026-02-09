const initSqlJs = require('sql.js');

// Mock browser environment globals
global.window = global;
global.window.initSqlJs = initSqlJs;

// Mock IndexedDB
const mockIndexedDB = {
    open: (name, version) => {
        const req = {};
        setTimeout(() => {
            if (req.onsuccess) {
                const db = {
                    createObjectStore: () => {},
                    transaction: () => ({
                        objectStore: () => ({
                            get: () => {
                                const r = {};
                                setTimeout(() => { if(r.onsuccess) { r.result = null; r.onsuccess({target:r}); } }, 0);
                                return r;
                            },
                            put: () => {}
                        }),
                        oncomplete: null, onerror: null
                    })
                };
                req.result = db;
                req.onsuccess({ target: req });
            }
        }, 0);
        return req;
    }
};
global.indexedDB = mockIndexedDB;

// Load DBWrapper
require('../db-wrapper.js');

describe('DBWrapper Optimization', () => {
    let db;

    beforeAll(async () => {
        await window.db.init();
        db = window.db;
        // Seed test table
        db.exec("CREATE TABLE IF NOT EXISTS test_perf (id INTEGER PRIMARY KEY, val TEXT)");
    });

    test('should correctly retrieve last_insert_rowid inside transaction', () => {
        const stmt = db.prepare("INSERT INTO test_perf (val) VALUES (?)");

        let id1, id2;

        db.transaction(() => {
            const res1 = stmt.run('test1');
            id1 = res1.lastInsertRowid;

            const res2 = stmt.run('test2');
            id2 = res2.lastInsertRowid;
        })();

        expect(id1).toBeDefined();
        expect(id2).toBeDefined();
        // IDs should be sequential if auto-increment works
        // Note: previous tests might have run on this DB instance if Jest doesn't reset fully?
        // But we just created it in beforeAll.
        // Assuming clean start (db in memory).
        // Since test_perf is new table, IDs start at 1.
        expect(id1).toBe(1);
        expect(id2).toBe(2);
    });

    test('should handle single inserts correctly (with implicit save/invalidation)', () => {
        const stmt = db.prepare("INSERT INTO test_perf (val) VALUES (?)");

        // This triggers save() internally, invalidating statements
        const res3 = stmt.run('test3');
        expect(res3.lastInsertRowid).toBe(3);

        // The stmt itself (user stmt) is invalidated by save() in db-wrapper logic!
        // So running it again should fail with "Statement closed" or similar if we don't re-prepare.
        // db-wrapper.js prepare() returns a wrapper that holds the stmt.
        // If stmt is closed, wrapper.run() fails.

        // So we expect this to throw?
        // Yes, unless db-wrapper re-prepares user statements (it doesn't).
        // But we want to test if lastIdStmt is handled correctly.
        // Since stmt.run() fails, lastIdStmt logic is not reached?
        // Wait, stmt.run() is first.

        // So we can't test reuse of user statement here.
        // We test reuse of lastIdStmt by re-preparing user statement.

        const stmt2 = db.prepare("INSERT INTO test_perf (val) VALUES (?)");
        const res4 = stmt2.run('test4');
        expect(res4.lastInsertRowid).toBe(4);
    });
});

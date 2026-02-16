
// Mock global window
global.window = {};

const { DBWrapper } = require('../db-wrapper.js');

describe('DBWrapper Sanitization', () => {
    let dbWrapper;
    let mockStmt;
    let mockDb;

    beforeEach(async () => {
        mockStmt = {
            bind: jest.fn(),
            run: jest.fn(),
            step: jest.fn().mockReturnValue(false),
            reset: jest.fn(),
            getAsObject: jest.fn(),
            get: jest.fn().mockReturnValue([1]) // for lastIdStmt
        };

        mockDb = {
            prepare: jest.fn().mockReturnValue(mockStmt),
            run: jest.fn(),
            exec: jest.fn((sql) => {
                if (sql.includes('COUNT(*)')) {
                     return [{ values: [[1]] }]; // Pretend already seeded
                }
                // Return columns to satisfy migrations checks (or skip them)
                return [{ values: [
                     [0, 'id', 'INTEGER'],
                     [1, 'category_id', 'INTEGER'],
                     [2, 'availability_rules', 'TEXT'],
                     [3, 'days_of_week', 'TEXT'],
                     [4, 'is_weekend', 'INTEGER'],
                     [5, 'weekend_start_day', 'INTEGER'],
                     [6, 'google_sheet_url', 'TEXT'],
                     [7, 'no_preference', 'INTEGER'],
                     [8, 'shift_id', 'INTEGER'],
                     [9, 'is_manual', 'INTEGER'],
                     [10, 'fill_first', 'INTEGER']
                 ] }];
            }),
            getRowsModified: jest.fn().mockReturnValue(1),
            export: jest.fn().mockReturnValue(new Uint8Array([]))
        };

        // Mock initSqlJs
        global.window.initSqlJs = jest.fn().mockResolvedValue({
            Database: jest.fn().mockImplementation(() => mockDb)
        });

        dbWrapper = new DBWrapper();
        dbWrapper.loadFromStorage = jest.fn().mockResolvedValue(null);
        dbWrapper.saveToStorage = jest.fn().mockResolvedValue();
        dbWrapper.scheduleSave = jest.fn();

        await dbWrapper.init();

        // Clear mocks from seed calls
        mockStmt.run.mockClear();
        mockStmt.bind.mockClear();
    });

    test('run() should pass null instead of undefined', () => {
        const stmt = dbWrapper.prepare("UPDATE test SET val = ?");
        stmt.run(undefined);

        // Expect mockStmt.run called with [null]
        expect(mockStmt.run).toHaveBeenCalledWith([null]);
    });

    test('all() should pass null instead of undefined', () => {
        const stmt = dbWrapper.prepare("SELECT * FROM test WHERE val = ?");
        stmt.all(undefined);

        expect(mockStmt.bind).toHaveBeenCalledWith([null]);
    });

    test('get() should pass null instead of undefined', () => {
        const stmt = dbWrapper.prepare("SELECT * FROM test WHERE val = ?");
        stmt.get(undefined);

        expect(mockStmt.bind).toHaveBeenCalledWith([null]);
    });
});

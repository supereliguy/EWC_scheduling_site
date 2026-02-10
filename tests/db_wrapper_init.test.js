// Mock Browser Environment BEFORE require
global.window = {};
global.indexedDB = {
    open: jest.fn()
};

const { DBWrapper } = require('../db-wrapper.js');

describe('DBWrapper.init', () => {
    let dbWrapper;
    let mockSQL;
    let mockDatabaseInstance;

    beforeEach(() => {
        // Reset window.initSqlJs
        global.window.initSqlJs = undefined;

        // Mock SQL.js
        mockDatabaseInstance = {
            run: jest.fn(),
            exec: jest.fn(),
            prepare: jest.fn(),
            export: jest.fn(),
            close: jest.fn()
        };

        mockSQL = {
            Database: jest.fn().mockImplementation(() => mockDatabaseInstance)
        };

        dbWrapper = new DBWrapper();
        // Mock loadFromStorage to avoid real IndexedDB calls
        dbWrapper.loadFromStorage = jest.fn();
        // Mock save
        dbWrapper.save = jest.fn();
        // Mock seed to avoid complex interactions during init test
        dbWrapper.seed = jest.fn();
    });

    test('should throw error if window.initSqlJs is missing', async () => {
        await expect(dbWrapper.init()).rejects.toThrow("SQL.js not loaded");
    });

    test('should return early if db is already initialized', async () => {
        dbWrapper.db = {}; // Already set
        global.window.initSqlJs = jest.fn(); // Mock to ensure it's not called

        await dbWrapper.init();

        expect(global.window.initSqlJs).not.toHaveBeenCalled();
    });

    test('should initialize SQL.js and create new database if storage is empty', async () => {
        // Mock window.initSqlJs to return our mockSQL
        global.window.initSqlJs = jest.fn().mockResolvedValue(mockSQL);
        // Mock storage empty
        dbWrapper.loadFromStorage.mockResolvedValue(null);

        await dbWrapper.init();

        expect(global.window.initSqlJs).toHaveBeenCalled();
        expect(dbWrapper.loadFromStorage).toHaveBeenCalled();

        // Check if Database constructor was called with no args
        expect(mockSQL.Database).toHaveBeenCalledWith();
        expect(dbWrapper.db).toBe(mockDatabaseInstance);
        expect(dbWrapper.seed).toHaveBeenCalled();
    });

    test('should initialize SQL.js and load database if storage has data', async () => {
        // Mock window.initSqlJs
        global.window.initSqlJs = jest.fn().mockResolvedValue(mockSQL);

        // Create dummy data
        const dummyData = new Uint8Array([1, 2, 3]);
        dbWrapper.loadFromStorage.mockResolvedValue(dummyData);

        await dbWrapper.init();

        expect(mockSQL.Database).toHaveBeenCalledWith(dummyData);
        expect(dbWrapper.db).toBe(mockDatabaseInstance);
        expect(dbWrapper.seed).toHaveBeenCalled();
    });
});

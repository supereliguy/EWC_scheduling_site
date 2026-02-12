
// Mock browser globals BEFORE requiring the module
global.window = global;
global.window.initSqlJs = () => {};
global.indexedDB = {};

const { DBWrapper } = require('../db-wrapper.js');

describe('DBWrapper.seed', () => {
    let dbWrapper;
    let mockDb;

    beforeEach(() => {
        // Reset mocks
        mockDb = {
            run: jest.fn(),
            exec: jest.fn(),
            prepare: jest.fn(() => ({
                bind: jest.fn(),
                step: jest.fn(),
                getAsObject: jest.fn(),
                reset: jest.fn(),
                run: jest.fn(),
                get: jest.fn()
            })),
            export: jest.fn(), // Called by save()
            getRowsModified: jest.fn(() => 1) // Added
        };

        // We need to create a new instance, but since we are testing seed(), we can just use a fresh one.
        dbWrapper = new DBWrapper();
        dbWrapper.db = mockDb;
        dbWrapper.save = jest.fn(); // Prevent actual save
    });

    describe('Schema Creation', () => {
        test('should execute the initial schema creation SQL', () => {
            // Mock migrations to return "already exists" to avoid noise
            // PRAGMA table_info returns one row per column. c[1] is the name.
            mockDb.exec.mockImplementation((sql) => {
                 if (sql.includes('site_users')) return [{ values: [[0, 'id'], [1, 'site_id'], [2, 'user_id'], [3, 'category_id']] }];
                 if (sql.includes('user_settings')) return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                 if (sql.includes('shifts')) return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                 if (sql.includes('global_settings')) return [{ values: [[1]] }];
                 return [];
            });

            dbWrapper.seed();

            expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS users'));
            expect(mockDb.run).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS user_settings'));
        });
    });

    describe('Migrations: site_users', () => {
        test('should add category_id column if missing', () => {
            // Mock schema check: no category_id
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) {
                    return [{ values: [[0, 'id'], [1, 'site_id'], [2, 'user_id']] }]; // No category_id
                }
                if (sql.includes('user_settings')) { // other migrations
                    return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                }
                if (sql.includes('shifts')) { // other migrations
                    return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                }
                 if (sql.includes('global_settings')) { // global settings count
                    return [{ values: [[1]] }];
                }
                return [];
            });

            dbWrapper.seed();

            expect(mockDb.run).toHaveBeenCalledWith("ALTER TABLE site_users ADD COLUMN category_id INTEGER");
        });

        test('should NOT add category_id column if already present', () => {
            // Mock schema check: has category_id
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) {
                    return [{ values: [[0, 'id'], [1, 'site_id'], [2, 'user_id'], [3, 'category_id']] }];
                }
                if (sql.includes('user_settings')) { // other migrations
                    return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                }
                if (sql.includes('shifts')) { // other migrations
                    return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                }
                 if (sql.includes('global_settings')) { // global settings count
                    return [{ values: [[1]] }];
                }
                return [];
            });

            dbWrapper.seed();

            expect(mockDb.run).not.toHaveBeenCalledWith("ALTER TABLE site_users ADD COLUMN category_id INTEGER");
        });

        test('should handle migration errors gracefully', () => {
            // Mock schema check to throw error
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) {
                    throw new Error('Simulated Migration Error');
                }
                // allow others to pass or handle gracefully
                if (sql.includes('user_settings')) return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                if (sql.includes('shifts')) return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                if (sql.includes('global_settings')) return [{ values: [[1]] }];
                return [];
            });

            dbWrapper.seed();

            expect(consoleSpy).toHaveBeenCalledWith("Migration error:", expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('Migrations: user_settings', () => {
         test('should add availability_rules column if missing', () => {
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) return [{ values: [[0, 'id'], [3, 'category_id']] }];
                if (sql.includes('user_settings')) return [{ values: [[0, 'user_id']] }]; // Missing availability_rules
                if (sql.includes('shifts')) return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                if (sql.includes('global_settings')) return [{ values: [[1]] }];
                return [];
            });

            dbWrapper.seed();

            expect(mockDb.run).toHaveBeenCalledWith("ALTER TABLE user_settings ADD COLUMN availability_rules TEXT DEFAULT '{}'");
        });

        test('should handle migration errors gracefully', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockDb.exec.mockImplementation((sql) => {
                 if (sql.includes('site_users')) return [{ values: [[0, 'id'], [3, 'category_id']] }];
                if (sql.includes('user_settings')) {
                    throw new Error('Simulated Migration Error (user_settings)');
                }
                if (sql.includes('shifts')) return [{ values: [[0, 'id'], [1, 'days_of_week']] }];
                if (sql.includes('global_settings')) return [{ values: [[1]] }];
                return [];
            });

            dbWrapper.seed();

            expect(consoleSpy).toHaveBeenCalledWith("Migration error (availability_rules):", expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('Migrations: shifts', () => {
         test('should add days_of_week column if missing', () => {
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) return [{ values: [[0, 'id'], [3, 'category_id']] }];
                if (sql.includes('user_settings')) return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                if (sql.includes('shifts')) return [{ values: [[0, 'id']] }]; // Missing days_of_week
                if (sql.includes('global_settings')) return [{ values: [[1]] }];
                return [];
            });

            dbWrapper.seed();

            expect(mockDb.run).toHaveBeenCalledWith("ALTER TABLE shifts ADD COLUMN days_of_week TEXT DEFAULT '0,1,2,3,4,5,6'");
        });

        test('should handle migration errors gracefully', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockDb.exec.mockImplementation((sql) => {
                if (sql.includes('site_users')) return [{ values: [[0, 'id'], [3, 'category_id']] }];
                if (sql.includes('user_settings')) return [{ values: [[0, 'user_id'], [1, 'availability_rules']] }];
                if (sql.includes('shifts')) {
                    throw new Error('Simulated Migration Error (shifts)');
                }
                 if (sql.includes('global_settings')) return [{ values: [[1]] }];
                return [];
            });

            dbWrapper.seed();

            expect(consoleSpy).toHaveBeenCalledWith("Migration error (days_of_week):", expect.any(Error));
            consoleSpy.mockRestore();
        });
    });
});


// Mock global window and db before requiring api-router
global.window = {
    db: {
        prepare: jest.fn(() => ({
            all: jest.fn(),
            get: jest.fn(),
            run: jest.fn(),
        })),
        transaction: jest.fn((cb) => cb),
        save: jest.fn(),
        db: {
            export: jest.fn(() => new Uint8Array([])),
        }
    },
    toDateStr: jest.fn((d) => {
        return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    }),
    generateSchedule: jest.fn(),
    SQL: { Database: jest.fn() }
};

const api = require('../api-router.js');

describe('API Router Tests', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;

        // Reset specific mock implementations if needed
        mockDb.prepare.mockReturnValue({
            all: jest.fn().mockReturnValue([]),
            get: jest.fn().mockReturnValue(null),
            run: jest.fn().mockReturnValue({ lastInsertRowid: 1 })
        });
    });

    describe('Router Core Mechanism', () => {
        test('should register and route a simple GET request', async () => {
            const handler = jest.fn((req, res) => res.json({ success: true }));
            api.get('/test-simple', handler);

            const result = await api.request('GET', '/test-simple');

            expect(handler).toHaveBeenCalled();
            expect(result).toEqual({ success: true });
        });

        test('should parse route parameters', async () => {
            const handler = jest.fn((req, res) => res.json({ id: req.params.id }));
            api.get('/test-params/:id', handler);

            const result = await api.request('GET', '/test-params/123');

            expect(handler).toHaveBeenCalled();
            expect(result).toEqual({ id: '123' });
        });

        test('should parse multiple route parameters', async () => {
            const handler = jest.fn((req, res) => res.json(req.params));
            api.get('/test/:p1/nested/:p2', handler);

            const result = await api.request('GET', '/test/abc/nested/def');

            expect(result).toEqual({ p1: 'abc', p2: 'def' });
        });

        test('should parse query strings', async () => {
            const handler = jest.fn((req, res) => res.json(req.query));
            api.get('/test-query', handler);

            const result = await api.request('GET', '/test-query?foo=bar&baz=123');

            expect(result).toEqual({ foo: 'bar', baz: '123' });
        });

        test('should pass request body', async () => {
            const handler = jest.fn((req, res) => res.json(req.body));
            api.post('/test-body', handler);

            const body = { data: 'payload' };
            const result = await api.request('POST', '/test-body', body);

            expect(result).toEqual(body);
        });

        test('should return 404 for unknown route', async () => {
            const result = await api.request('GET', '/unknown-route');
            expect(result).toEqual({ error: 'Not Found', status: 404 });
        });

        test('should return 404 for wrong method', async () => {
            api.get('/method-test', () => {});
            const result = await api.request('POST', '/method-test');
            expect(result).toEqual({ error: 'Not Found', status: 404 });
        });

        test('should handle handler errors gracefully (500)', async () => {
            api.get('/error-test', () => { throw new Error('Boom'); });

            // Suppress console.error for this test
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const result = await api.request('GET', '/error-test');

            expect(result).toEqual({ error: 'Boom', status: 500 });
            consoleSpy.mockRestore();
        });

        test('should handle status codes set by handler', async () => {
            api.get('/status-test', (req, res) => res.status(400).json({ error: 'Bad Request' }));

            const result = await api.request('GET', '/status-test');

            expect(result).toEqual({ error: 'Bad Request', status: 400 });
        });
    });

    describe('Key Endpoints Integration', () => {
        // Auth
        test('GET /api/me should return admin user', async () => {
            const result = await api.request('GET', '/api/me');
            expect(result.user).toBeDefined();
            expect(result.user.username).toBe('admin');
            expect(result.user.role).toBe('admin');
        });

        // Users
        test('GET /api/users should fetch all users', async () => {
            const mockUsers = [{ id: 1, username: 'test' }];
            const allSpy = jest.fn().mockReturnValue(mockUsers);
            mockDb.prepare.mockReturnValue({ all: allSpy });

            const result = await api.request('GET', '/api/users');

            expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM users ORDER BY username ASC');
            expect(result).toEqual({ users: mockUsers });
        });

        test('POST /api/users should insert user', async () => {
            const runSpy = jest.fn().mockReturnValue({ lastInsertRowid: 10 });
            mockDb.prepare.mockReturnValue({ run: runSpy });

            const body = { username: 'newuser', role: 'user' };
            const result = await api.request('POST', '/api/users', body);

            expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO users (username, role) VALUES (?, ?)');
            expect(runSpy).toHaveBeenCalledWith('newuser', 'user');
            expect(result).toEqual({ message: 'User created', id: 10 });
        });

        test('GET /api/sites/:siteId/users should fetch users sorted by username', async () => {
            const mockUsers = [{ id: 1, username: 'test' }];
            const allSpy = jest.fn().mockReturnValue(mockUsers);
            mockDb.prepare.mockReturnValue({ all: allSpy });

            const result = await api.request('GET', '/api/sites/1/users');

            expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY u.username ASC'));
            expect(result).toEqual({ users: mockUsers });
        });

        // Schedule
        test('GET /api/schedule with start/days should calculate date range correctly', async () => {
            const allSpy = jest.fn().mockReturnValue([]);
            mockDb.prepare.mockReturnValue({ all: allSpy });

            // Query: start=2023-01-01, days=5
            // Expected End: 2023-01-05
            const result = await api.request('GET', '/api/schedule?siteId=1&startDate=2023-01-01&days=5');

            expect(mockDb.prepare).toHaveBeenCalledTimes(2); // Assignments + Requests
            // Verify date calculation
            // The first query is for assignments
            const callArgs = allSpy.mock.calls;
            // assignments query is usually first or second depending on order
            // Actually prepare is called twice, returning an object with .all() method.
            // Since we return the SAME spy object for all prepare calls, we can check the spy on .all()

            // Wait, we mocked prepare to return a NEW object each time or the SAME object?
            // In beforeEach: mockReturnValue({...}) returns the SAME object instance if not using mockImplementation?
            // "mockReturnValue" returns the value provided. So yes, same object.

            // However, to be precise, let's verify arguments passed to .all()
            // The first call to all() should be assignments: siteId, startStr, endStr
            // The second call to all() should be requests: siteId, startStr, endStr

            // Assignments query params
            expect(allSpy).toHaveBeenCalledWith('1', '2023-01-01', '2023-01-05');
        });

        test('GET /api/schedule with month/year should calculate range', async () => {
            const allSpy = jest.fn().mockReturnValue([]);
            mockDb.prepare.mockReturnValue({ all: allSpy });

            await api.request('GET', '/api/schedule?siteId=1&month=5&year=2023');

            // Month 5 -> 05
            expect(allSpy).toHaveBeenCalledWith('1', '2023-05-01', '2023-05-31');
        });

        test('GET /api/schedule should fetch assignments sorted by date and username', async () => {
            const allSpy = jest.fn().mockReturnValue([]);
            mockDb.prepare.mockReturnValue({ all: allSpy });

            await api.request('GET', '/api/schedule?siteId=1&startDate=2023-01-01&days=5');

            expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY a.date ASC, u.username ASC'));
        });

        test('POST /api/schedule/generate should delegate to window.generateSchedule', async () => {
            const mockResult = { assignments: [], conflictReport: [] };
            global.window.generateSchedule.mockResolvedValue(mockResult);

            const body = { siteId: 1, startDate: '2023-01-01', days: 7, force: true };
            const result = await api.request('POST', '/api/schedule/generate', body);

            expect(global.window.generateSchedule).toHaveBeenCalledWith({
                siteId: 1,
                startDate: '2023-01-01',
                days: 7,
                force: true
            });
            expect(result).toEqual({
                message: 'Generated',
                assignments: [],
                conflictReport: []
            });
        });

        // Sites
        test('POST /api/sites/bulk should verify bulk insertion logic', async () => {
            // This endpoint uses transaction, so we need to ensure transaction callback is executed
            // Our mock: transaction: jest.fn((cb) => cb) returns the callback, but doesn't execute it immediately unless we call it?
            // Wait: "window.db.transaction(() => { ... })()" - typically transaction returns a wrapper function
            // In api-router: window.db.transaction(() => { ... })();
            // My mock in beforeEach: transaction: jest.fn((cb) => cb)
            // So: api calls transaction(cb), getting back cb. Then it calls cb().
            // Correct.

            const checkStmt = { get: jest.fn() };
            const insertStmt = { run: jest.fn().mockReturnValue({ lastInsertRowid: 99 }) };
            const linkStmt = { run: jest.fn() };

            mockDb.prepare
                .mockReturnValueOnce(checkStmt) // Check
                .mockReturnValueOnce(insertStmt) // Insert
                .mockReturnValueOnce(linkStmt); // Link

            const body = { sites: [{ name: 'Site A' }, { name: 'Site B' }] };

            // Assume Site A is new, Site B exists
            checkStmt.get
                .mockReturnValueOnce(undefined) // Site A doesn't exist
                .mockReturnValueOnce({ id: 2 }); // Site B exists

            const result = await api.request('POST', '/api/sites/bulk', body);

            expect(insertStmt.run).toHaveBeenCalledWith('Site A');
            expect(insertStmt.run).toHaveBeenCalledTimes(1);
            expect(result.added).toContain('Site A');
            expect(result.failed[0].item).toBe('Site B');
        });

        // Settings (Global)
        test('PUT /api/settings/global should save settings', async () => {
            const runSpy = jest.fn();
            mockDb.prepare.mockReturnValue({ run: runSpy });

            const body = { setting1: 'value1', setting2: 'value2' };
            await api.request('PUT', '/api/settings/global', body);

            // Should prepare statement once
            expect(mockDb.prepare).toHaveBeenCalledWith('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
            // Should run twice
            expect(runSpy).toHaveBeenCalledWith('setting1', 'value1');
            expect(runSpy).toHaveBeenCalledWith('setting2', 'value2');
        });

        // Assignments Update
        test('PUT /api/schedule/assignment should update assignment', async () => {
            const runSpy = jest.fn();
            mockDb.prepare.mockReturnValue({ run: runSpy });

            const body = { siteId: 1, date: '2023-01-01', userId: 10, shiftId: 5 };
            await api.request('PUT', '/api/schedule/assignment', body);

            // Expect deletes first
            expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM assignments WHERE site_id = ? AND date = ? AND user_id = ?');
            expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM requests WHERE site_id = ? AND date = ? AND user_id = ?');

            // Expect insert assignment
            expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO assignments'));
            // Expect 5 args: siteId, date, userId, shiftId, isLocked (default 1)
            expect(runSpy).toHaveBeenCalledWith(1, '2023-01-01', 10, '5', 1);
        });

        test('PUT /api/schedule/assignment should handle OFF request', async () => {
            const runSpy = jest.fn();
            mockDb.prepare.mockReturnValue({ run: runSpy });

            const body = { siteId: 1, date: '2023-01-01', userId: 10, shiftId: 'OFF' };
            await api.request('PUT', '/api/schedule/assignment', body);

            // Expect insert request
            expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO requests (site_id, date, user_id, type) VALUES (?, ?, ?, ?)');
            expect(runSpy).toHaveBeenCalledWith(1, '2023-01-01', 10, 'off');
        });
    });
});

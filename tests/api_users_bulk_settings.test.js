
// Mock global window and db before requiring api-router
global.window = {
    db: {
        prepare: jest.fn(),
        transaction: jest.fn((cb) => cb), // Executes callback immediately
    },
    toDateStr: jest.fn((d) => {
        return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    }),
};

const api = require('../api-router.js');

describe('API Router - Bulk User Settings', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;
    });

    test('PUT /api/users/bulk-settings should update existing users and insert new ones', async () => {
        // Mocks for statements
        const getStmt = { get: jest.fn() };
        const updateStmt = { run: jest.fn() };
        const insertStmt = { run: jest.fn() };

        // Determine which statement is returned by prepare based on SQL content
        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('SELECT')) return getStmt;
            if (sql.includes('UPDATE')) return updateStmt;
            if (sql.includes('INSERT')) return insertStmt;
            return { run: jest.fn(), get: jest.fn() };
        });

        // Input Payload
        const body = [
            {
                userId: 1,
                settings: { target_shifts: 10, max_consecutive_shifts: 6 }
            },
            {
                userId: 2,
                settings: { target_shifts: 12 } // New user
            }
        ];

        // Mock Behavior
        // User 1 exists
        getStmt.get.mockReturnValueOnce({
            user_id: 1,
            target_shifts: 8,
            max_consecutive_shifts: 5,
            min_days_off: 2,
            target_shifts_variance: 2,
            preferred_block_size: 3
        });
        // User 2 does not exist
        getStmt.get.mockReturnValueOnce(undefined);

        // Execute
        const result = await api.request('PUT', '/api/users/bulk-settings', body);

        // Verify
        expect(result).toEqual({ message: 'Bulk settings updated' });

        // User 1 (Update)
        // Should have checked existence
        expect(getStmt.get).toHaveBeenCalledWith(1);
        // Should update with merged values (new target=10, new max=6)
        // Since we are mocking, we just check if UPDATE was called with expected params
        // The implementation should probably use the provided values or keep existing ones.
        // For UPDATE, we expect it to be called.
        expect(updateStmt.run).toHaveBeenCalledTimes(1);
        // We can check arguments if we know the exact SQL and order.
        // Assuming implementation uses named params or specific order.
        // Let's assume standard order matching schema: max, min, night, target, variance, block, ranking, avail, no_pref, id
        // arg[0] = max_consecutive (6)
        // arg[3] = target_shifts (10)
        // arg[9] = user_id (1)
        const updateArgs = updateStmt.run.mock.calls[0];
        expect(updateArgs[0]).toBe(6); // max_consecutive
        expect(updateArgs[3]).toBe(10); // target_shifts
        expect(updateArgs[9]).toBe(1);  // user_id

        // User 2 (Insert)
        expect(getStmt.get).toHaveBeenCalledWith(2);
        expect(insertStmt.run).toHaveBeenCalledTimes(1);
        const insertArgs = insertStmt.run.mock.calls[0];
        // id, max, min, night, target, variance, block, ranking, avail, no_pref
        expect(insertArgs[0]).toBe(2);  // user_id
        expect(insertArgs[4]).toBe(12); // target_shifts
    });

    test('PUT /api/users/bulk-settings should preserve fields not present in update for existing users', async () => {
        const getStmt = { get: jest.fn() };
        const updateStmt = { run: jest.fn() };

        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('SELECT')) return getStmt;
            if (sql.includes('UPDATE')) return updateStmt;
            return { run: jest.fn() };
        });

        const body = [{ userId: 1, settings: { min_days_off: 5 } }];

        // Existing settings has specialized shift_ranking
        getStmt.get.mockReturnValueOnce({
            user_id: 1,
            min_days_off: 2,
            shift_ranking: '[1,2,3]',
            availability_rules: '{"test":1}'
        });

        await api.request('PUT', '/api/users/bulk-settings', body);

        const args = updateStmt.run.mock.calls[0];
        // min_days_off is index 1 (based on previous test assumption, check implementation later)
        expect(args[1]).toBe(5); // New value
        // shift_ranking is index 6
        expect(args[6]).toBe('[1,2,3]'); // Preserved
        // availability_rules is index 7
        expect(args[7]).toBe('{"test":1}'); // Preserved
    });

    test('PUT /api/users/bulk-settings should use defaults for new users with missing fields', async () => {
        const getStmt = { get: jest.fn() };
        const insertStmt = { run: jest.fn() };

        mockDb.prepare.mockImplementation((sql) => {
            if (sql.includes('SELECT')) return getStmt;
            if (sql.includes('INSERT')) return insertStmt;
            return { run: jest.fn() };
        });

        const body = [{ userId: 3, settings: { target_shifts: 15 } }];
        getStmt.get.mockReturnValueOnce(undefined);

        await api.request('PUT', '/api/users/bulk-settings', body);

        const args = insertStmt.run.mock.calls[0];
        // Check defaults
        // max_consecutive (idx 1) -> default? (implementation detail, usually 5 or null)
        // availability_rules (idx 8) -> '{}'
        expect(args[8]).toBe('{}');
    });
});

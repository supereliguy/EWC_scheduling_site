
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

describe('Reproduction: User Category Reset', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;
    });

    test('PUT /api/sites/:id/users should preserve existing user categories', async () => {
        const siteId = 1;
        const existingUserId = 101;
        const newUserId = 102;

        // Mock existing users in the database
        // The fix will likely require querying existing users first.
        const allSpy = jest.fn().mockReturnValue([
            { user_id: existingUserId, category_id: 5 }
        ]);

        // Mock the statements
        const runSpy = jest.fn();
        mockDb.prepare.mockReturnValue({
            all: allSpy,
            run: runSpy
        });

        // Request to update users: Keep 101, Add 102
        const body = { userIds: [existingUserId, newUserId] };
        await api.request('PUT', `/api/sites/${siteId}/users`, body);

        // Analysis of calls
        const calls = mockDb.prepare.mock.calls.map(c => c[0]);

        // 1. Check if we queried existing users
        const queriedExisting = calls.some(sql => sql.includes('SELECT user_id FROM site_users'));

        // 2. Check if we wiped all users (The BUG)
        const wipedAll = calls.some(sql => sql.includes('DELETE FROM site_users WHERE site_id = ?') && !sql.includes('user_id'));

        // 3. Check if we deleted specific user (Correct behavior for removal)
        // In this test, we are NOT removing anyone, so no specific delete should happen for existingUserId
        // But we are adding newUserId.

        // 4. Check inserts
        // We expect INSERT for newUserId
        // We expect NO INSERT for existingUserId (because that would mean we deleted them or are duplicating)

        // For the test to PASS (after fix), we want:
        // - queriedExisting to be true
        // - wipedAll to be false

        // Current Code Behavior (Expected to FAIL):
        // - wipedAll is true

        console.log('SQL Calls:', calls);

        if (wipedAll) {
            throw new Error('TEST FAILED: The code is wiping all users, which resets categories.');
        }

        if (!queriedExisting) {
            throw new Error('TEST FAILED: The code is not checking existing users, so it cannot perform a smart update.');
        }

        // Verify we only inserted the new user
        // The runSpy would be called for INSERT statement
        // We can't easily check runSpy arguments because prepare returns a shared mock object in this setup
        // But we can check that we didn't prepare a global delete
    });
});

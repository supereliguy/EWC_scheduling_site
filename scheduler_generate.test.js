const { generateSchedule } = require('./scheduler');

describe('generateSchedule', () => {
    let mockDb;
    let mockData;

    beforeEach(() => {
        // Default Mock Data
        mockData = {
            shifts: [],
            users: [],
            userSettings: [],
            globalSettings: [],
            assignments: [],
            requests: []
        };

        // Mock DB Implementation
        const prepareMock = jest.fn((query) => {
            const q = query.trim();

            // Helper to return mock result with both .all() and .run() to handle flexible usage
            const returnResult = (data) => ({
                all: jest.fn().mockReturnValue(data || []),
                run: jest.fn()
            });

            if (q.includes('FROM shifts')) {
                return returnResult(mockData.shifts);
            }
            if (q.includes('FROM users')) {
                return returnResult(mockData.users);
            }
            if (q.includes('FROM user_settings')) {
                return returnResult(mockData.userSettings);
            }
            if (q.includes('FROM global_settings')) {
                return returnResult(mockData.globalSettings);
            }
            if (q.includes('FROM assignments')) {
                if (q.startsWith('DELETE')) {
                     return { run: jest.fn(), all: jest.fn() };
                }
                // Handle is_locked query specially
                if (q.includes('is_locked = 1')) {
                     return returnResult(mockData.assignments.filter(a => a.is_locked));
                }
                // Previous context query (not locked specifically)
                // In generateSchedule:
                // 1. Prev assignments (context)
                // 2. Locked assignments (target period)
                // My mock just returns all assignments.
                // It should be fine as long as I set up data correctly.
                return returnResult(mockData.assignments);
            }
            if (q.includes('FROM requests')) {
                return returnResult(mockData.requests);
            }
            if (q.startsWith('INSERT')) {
                return { run: jest.fn(), all: jest.fn() };
            }

            // Default fallback
            return returnResult([]);
        });

        mockDb = {
            prepare: prepareMock,
            transaction: jest.fn((callback) => callback), // Execute immediately
        };
        global.db = mockDb;
        // Mock window object to simulate browser environment if needed by the code under test
        global.window = { db: mockDb };
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete global.window;
    });

    test('should generate a schedule successfully (happy path)', async () => {
        // Setup specific data for this test
        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];

        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 1 });

        expect(result.success).toBe(true);
        expect(result.assignments).toHaveLength(1);
        expect(result.assignments[0]).toMatchObject({
            userId: 1,
            shiftId: 1,
            date: '2023-01-01'
        });

        // Verify DB interactions
        expect(mockDb.transaction).toHaveBeenCalled();
        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO assignments'));
    });

    test('should fail and return conflict report if constraints cannot be met (force=false)', async () => {
        // 2 slots needed, 1 user available
        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 2, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];

        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 1, force: false });

        expect(result.success).toBe(false);
        expect(result.assignments).toHaveLength(1); // 1 assigned
        expect(result.conflictReport.length).toBeGreaterThan(0);

        // Should NOT save
        expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    test('should succeed with conflicts if force=true', async () => {
        // User requests OFF. Strict fails. Force ignores it.
        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];
        mockData.requests = [{ user_id: 1, date: '2023-01-01', type: 'off' }];

        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 1, force: true });

        // Force mode should fill the slot
        expect(result.assignments).toHaveLength(1);
        expect(result.assignments[0]).toMatchObject({
            userId: 1,
            shiftId: 1,
            isHit: true
        });

        expect(result.success).toBe(false);
        expect(mockDb.transaction).toHaveBeenCalled();
    });

    test('should respect user settings (max consecutive shifts)', async () => {
        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];
        mockData.userSettings = [{ user_id: 1, max_consecutive_shifts: 1 }]; // User setting overrides global default (5)

        // Run for 2 days. Day 1 ok (consecutive=1). Day 2 fail (consecutive=2 > 1).
        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 2, force: false });

        const day1 = result.assignments.find(a => a.date === '2023-01-01');
        expect(day1).toBeDefined();

        const day2 = result.assignments.find(a => a.date === '2023-01-02');
        expect(day2).toBeUndefined();

        expect(result.success).toBe(false);
    });

    test('should respect blocked days in availability rules', async () => {
        // Sunday (0) is blocked for user1. '2023-01-01' is a Sunday.
        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];

        const rules = JSON.stringify({ blocked_days: [0], blocked_shifts: [] });
        mockData.userSettings = [{ user_id: 1, availability_rules: rules }];

        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 1, force: false });

        expect(result.assignments).toHaveLength(0);
        expect(result.success).toBe(false);
    });

    test('should respect locked assignments', async () => {
        // Locked assignment for user1 on Day 1.
        // Even if requested off, locked should persist?
        // Logic: runGreedy initializes assignments with lockedAssignments.
        // It updates state for locked users.
        // It skips strict check for locked users.

        mockData.shifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        mockData.users = [{ id: 1, username: 'user1', role: 'user', category_priority: 10 }];

        // Existing Locked Assignment
        mockData.assignments = [{
            id: 100, site_id: 1, date: '2023-01-01', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day'
        }];

        // Request Off (normally a conflict)
        mockData.requests = [{ user_id: 1, date: '2023-01-01', type: 'off' }];

        const result = await generateSchedule({ siteId: 1, startDate: '2023-01-01', days: 1, force: false });

        // Locked assignment should be in result
        expect(result.assignments).toHaveLength(1);
        expect(result.assignments[0].isLocked).toBe(true);
        expect(result.assignments[0].userId).toBe(1);

        // Should succeed because locked assignments are "baked in" and don't trigger conflict report?
        // Wait, locked assignments are NOT checked against constraints in `runGreedy`.
        // They just update state.
        // So success should be true.
        expect(result.success).toBe(true);
    });
});

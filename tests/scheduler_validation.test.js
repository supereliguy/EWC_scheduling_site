
const scheduler = require('../scheduler');

// Mock DB
const mockDB = {
    prepare: jest.fn(),
    transaction: jest.fn((cb) => cb)
};

global.db = mockDB;
global.window = { db: mockDB };

describe('validateSchedule', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should identify hard constraint violations', () => {
        const siteId = 1;
        const startDate = '2023-01-01';
        const days = 1;

        const users = [{ id: 1, username: 'User1', role: 'user', category_priority: 10 }];
        const shifts = [{ id: 10, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        const userSettings = [{
            user_id: 1,
            availability_rules: JSON.stringify({ blocked_shifts: [10], blocked_days: [] }),
            target_shifts: 1, // Set target=1 to avoid "Under Target" warning
            target_shifts_variance: 0
        }];

        // Assignments provided to validate
        const assignments = [{ date: '2023-01-01', shiftId: 10, userId: 1, isLocked: false }];

        mockDB.prepare.mockImplementation((query) => {
            const ret = {
                all: () => [],
                get: () => ({ id: 1 }) // Default site
            };

            if (query.includes('FROM users')) ret.all = () => users;
            if (query.includes('FROM shifts')) ret.all = () => shifts;
            if (query.includes('FROM user_settings')) ret.all = () => userSettings;
            if (query.includes('FROM global_settings')) ret.all = () => [{ key: 'rule_weight_max_consecutive', value: '5' }];

            return ret;
        });

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1]).toBeDefined();

        // Debug
        if(report[1].issues.length > 1) console.log(report[1].issues);

        expect(report[1].status).toBe('error');
        expect(report[1].issues.length).toBe(1);
        expect(report[1].issues[0].type).toBe('hard');
        expect(report[1].issues[0].reason).toContain('Availability');
    });

    test('should identify soft constraint violations', () => {
        const siteId = 1;
        const startDate = '2023-01-03';
        const days = 1;

        const users = [{ id: 1, username: 'User1', role: 'user', category_priority: 10 }];
        const shifts = [{ id: 10, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
        const userSettings = [{
            user_id: 1,
            max_consecutive_shifts: 1,
            target_shifts: 4,
            target_shifts_variance: 2
        }];

        mockDB.prepare.mockImplementation((query) => {
            const ret = {
                all: () => [],
                get: () => ({ id: 1 })
            };

            if (query.includes('FROM assignments a')) {
                // Context query for previous assignments
                ret.all = (sid, start, end) => {
                    // Check if this is the context query (ending before start date)
                    if (end === '2023-01-02') {
                        return [
                            { date: '2023-01-01', shift_id: 10, user_id: 1 },
                            { date: '2023-01-02', shift_id: 10, user_id: 1 }
                        ];
                    }
                    return [];
                };
            }
            if (query.includes('FROM users')) ret.all = () => users;
            if (query.includes('FROM shifts')) ret.all = () => shifts;
            if (query.includes('FROM user_settings')) ret.all = () => userSettings;
            if (query.includes('FROM global_settings')) ret.all = () => [{ key: 'rule_weight_max_consecutive', value: '5' }];

            return ret;
        });

        const assignments = [{ date: '2023-01-03', shiftId: 10, userId: 1 }];

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1]).toBeDefined();
        // Expect warning for max consecutive
        expect(report[1].status).toBe('warning');

        const consecutiveIssue = report[1].issues.find(i => i.reason.includes('Max Consecutive'));
        expect(consecutiveIssue).toBeDefined();
        expect(consecutiveIssue.type).toBe('soft');
    });

    test('should pass with no violations', () => {
        const siteId = 1;
        const startDate = '2023-01-01';
        const days = 1;

        const users = [{ id: 1, username: 'User1', role: 'user', category_priority: 10 }];
        const shifts = [{ id: 10, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];

        // Target: 2. Variance: 1. Min: 1. Assigned: 1. OK.
        // Over Target: 1 >= 2? No. OK.
        const userSettings = [{
            user_id: 1,
            target_shifts: 2,
            target_shifts_variance: 1
        }];

        mockDB.prepare.mockImplementation((query) => {
            const ret = {
                all: () => [],
                get: () => ({ id: 1 })
            };
            if (query.includes('FROM users')) ret.all = () => users;
            if (query.includes('FROM shifts')) ret.all = () => shifts;
            if (query.includes('FROM user_settings')) ret.all = () => userSettings;
            if (query.includes('FROM global_settings')) ret.all = () => []; // Defaults
            return ret;
        });

        const assignments = [{ date: '2023-01-01', shiftId: 10, userId: 1 }];

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1].status).toBe('ok');
        expect(report[1].issues.length).toBe(0);
    });
});

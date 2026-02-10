
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
            availability_rules: JSON.stringify({ blocked_shifts: [10], blocked_days: [] })
        }];

        const assignments = [{ date: '2023-01-01', shiftId: 10, userId: 1, isLocked: false }];

        mockDB.prepare.mockImplementation((query) => {
            if (query.includes('FROM users')) return { all: () => users };
            if (query.includes('FROM shifts')) return { all: () => shifts };
            if (query.includes('FROM user_settings')) return { all: () => userSettings };
            return { all: () => [] };
        });

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1]).toBeDefined();
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
            max_consecutive_shifts: 1 // Only 1 day allowed
        }];

        mockDB.prepare.mockImplementation((query) => {
            if (query.includes('FROM assignments a')) {
                return {
                    all: jest.fn((sid, start, end) => {
                        // Check if this is the context query (ending before start date)
                        if (end === '2023-01-02') {
                            return [
                                { date: '2023-01-01', shift_id: 10, user_id: 1 },
                                { date: '2023-01-02', shift_id: 10, user_id: 1 }
                            ];
                        }
                        return [];
                    })
                };
            }
            if (query.includes('FROM users')) return { all: () => users };
            if (query.includes('FROM shifts')) return { all: () => shifts };
            if (query.includes('FROM user_settings')) return { all: () => userSettings };
            return { all: () => [] };
        });

        const assignments = [{ date: '2023-01-03', shiftId: 10, userId: 1 }];

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1]).toBeDefined();
        expect(report[1].status).toBe('warning');
        expect(report[1].issues.length).toBe(1);
        expect(report[1].issues[0].type).toBe('soft');
        expect(report[1].issues[0].reason).toContain('Max Consecutive');
    });

    test('should pass with no violations', () => {
        const siteId = 1;
        const startDate = '2023-01-01';
        const days = 1;

        const users = [{ id: 1, username: 'User1' }];
        const shifts = [{ id: 10, name: 'Day', days_of_week: '0,1,2,3,4,5,6' }];

        mockDB.prepare.mockImplementation((query) => {
            if (query.includes('FROM users')) return { all: () => users };
            if (query.includes('FROM shifts')) return { all: () => shifts };
            return { all: () => [] };
        });

        const assignments = [{ date: '2023-01-01', shiftId: 10, userId: 1 }];

        const report = scheduler.validateSchedule({ siteId, startDate, days, assignments });

        expect(report[1].status).toBe('ok');
        expect(report[1].issues.length).toBe(0);
    });
});

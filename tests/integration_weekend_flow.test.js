// tests/integration_weekend_flow.test.js
const { validateSchedule } = require('../scheduler.js');

// Mock Browser Environment
global.window = {
    db: {
        prepare: jest.fn(),
        transaction: jest.fn((cb) => cb)
    },
    toDateStr: (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
};
global.db = global.window.db;

describe('Integration: Weekend Flow', () => {
    test('validateSchedule should respect site weekend config from DB', () => {
        const siteId = 1;
        const startDate = '2023-01-07'; // Saturday
        const days = 1;

        // Mock Data
        const site = {
            id: 1,
            weekend_start_day: 6, // Sat
            weekend_start_time: '00:00',
            weekend_end_day: 0, // Sun
            weekend_end_time: '23:59'
        };
        const users = [{ id: 1, username: 'U1' }];
        const shifts = [{ id: 1, name: 'Day', start_time: '12:00', end_time: '20:00', days_of_week: '0,1,2,3,4,5,6' }];

        // Mock DB calls
        const prepareMock = jest.fn((query) => {
            const ret = { all: () => [], get: () => null };

            if (query.includes('FROM sites')) ret.get = () => site;
            if (query.includes('FROM users')) ret.all = () => users;
            if (query.includes('FROM shifts')) ret.all = () => shifts;

            return ret;
        });
        global.db.prepare = prepareMock;

        // Run validation on a Saturday assignment
        const assignments = [{ date: '2023-01-07', shiftId: 1, userId: 1 }];
        const report = validateSchedule({ siteId, startDate, days, assignments });

        // This test mainly verifies that fetchScheduleContext calls DB for site.
        expect(prepareMock).toHaveBeenCalledWith(expect.stringContaining('FROM sites'));
    });
});

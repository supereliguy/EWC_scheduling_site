
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

describe('API Router Shift Creation Tests', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;
    });

    test('POST /api/sites/:siteId/shifts should parse inputs correctly', async () => {
        const runSpy = jest.fn().mockReturnValue({ lastInsertRowid: 10 });
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const body = {
            name: 'Morning',
            start_time: '08:00',
            end_time: '16:00',
            required_staff: '5', // String input
            days_of_week: '0,1,2,3,4'
        };

        const result = await api.request('POST', '/api/sites/123/shifts', body);

        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO shifts'));

        // Verify arguments passed to run()
        // Expected: siteId (int), name, start, end, staff (int), days, weekend
        expect(runSpy).toHaveBeenCalledWith(
            123, // parsed siteId
            'Morning',
            '08:00',
            '16:00',
            5, // parsed required_staff
            '0,1,2,3,4',
            0 // default weekend
        );

        expect(result).toEqual({ message: 'Shift created' });
    });

    test('POST /api/sites/:siteId/shifts should handle missing required_staff', async () => {
        const runSpy = jest.fn();
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const body = {
            name: 'Morning',
            start_time: '08:00',
            end_time: '16:00',
            // required_staff missing
            days_of_week: '0,1,2,3,4'
        };

        await api.request('POST', '/api/sites/456/shifts', body);

        // Verify default staff = 1
        expect(runSpy).toHaveBeenCalledWith(
            456,
            'Morning',
            '08:00',
            '16:00',
            1, // default
            '0,1,2,3,4',
            0
        );
    });

    test('POST /api/sites/:siteId/shifts should handle is_weekend flag', async () => {
        const runSpy = jest.fn();
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const body = {
            name: 'Weekend',
            start_time: '08:00',
            end_time: '16:00',
            required_staff: 2,
            is_weekend: true
        };

        await api.request('POST', '/api/sites/789/shifts', body);

        expect(runSpy).toHaveBeenCalledWith(
            789,
            'Weekend',
            '08:00',
            '16:00',
            2,
            '0,1,2,3,4,5,6', // default days
            1 // is_weekend = 1
        );
    });
});

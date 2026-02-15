
global.window = {
    db: {
        prepare: jest.fn(() => ({
            run: jest.fn(),
            all: jest.fn(),
            get: jest.fn()
        })),
        transaction: jest.fn((cb) => cb)
    },
    toDateStr: jest.fn(),
    generateSchedule: jest.fn(),
    SQL: { Database: jest.fn() }
};

const api = require('../api-router.js');

describe('Site Weekend Configuration API', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;
    });

    test('PUT /api/sites/:id should update weekend configuration', async () => {
        const runSpy = jest.fn();
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const siteId = 1;
        const body = {
            weekend_start_day: 5,
            weekend_start_time: '21:00',
            weekend_end_day: 0,
            weekend_end_time: '16:00'
        };

        const result = await api.request('PUT', `/api/sites/${siteId}`, body);

        expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE sites'));

        // args: name, desc, google_sheet_url, ws_day, ws_time, we_day, we_time, id
        expect(runSpy).toHaveBeenCalledWith(
            undefined,
            undefined,
            undefined, // google_sheet_url
            5,
            '21:00',
            0,
            '16:00',
            '1'
        );
        expect(result).toEqual({ message: 'Site updated' });
    });

    test('PUT /api/sites/:id should update name and description', async () => {
        const runSpy = jest.fn();
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const siteId = 2;
        const body = {
            name: 'New Name',
            description: 'New Desc'
        };

        const result = await api.request('PUT', `/api/sites/${siteId}`, body);

        expect(runSpy).toHaveBeenCalledWith(
            'New Name',
            'New Desc',
            undefined, // google_sheet_url
            undefined,
            undefined,
            undefined,
            undefined,
            '2'
        );
    });
});


describe('API Schedule Endpoint', () => {
    let api;
    let windowMock;

    beforeEach(() => {
        // Mock DB
        const dbMock = {
            prepare: jest.fn(() => ({
                all: jest.fn(() => []), // Return empty array for assignments/requests
                get: jest.fn(() => null),
                run: jest.fn(),
            })),
            transaction: jest.fn((cb) => cb),
        };

        // Mock Window
        windowMock = {
            db: dbMock,
            generateSchedule: jest.fn(),
            // toDateStr will be attached here by scheduler.js eventually
        };
        global.window = windowMock;

        // Reset modules to ensure clean state
        jest.resetModules();

        // Load scheduler.js (this runs top-level code and attaches to window if present)
        // We need to require it so it attaches generateSchedule (and later toDateStr) to window
        require('../scheduler.js');

        // Load api-router.js
        api = require('../api-router.js');
    });

    test('GET /api/schedule with startDate/days should return schedule data', async () => {
        const result = await api.request('GET', '/api/schedule?siteId=1&startDate=2023-01-01&days=5');

        expect(result).toHaveProperty('schedule');
        expect(result.schedule).toEqual([]); // Mock returns empty
        expect(result).toHaveProperty('requests');
    });

    test('GET /api/schedule with month/year should return schedule data', async () => {
         const result = await api.request('GET', '/api/schedule?siteId=1&month=1&year=2023');
         expect(result).toHaveProperty('schedule');
    });
});

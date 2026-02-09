
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
    }
};

const api = require('../api-router.js');

describe('API Router Request', () => {
    beforeEach(() => {
        // Clear routes
        api.routes = {
            GET: {},
            POST: {},
            PUT: {},
            DELETE: {}
        };
    });

    test('request should return 404 for non-existent path', async () => {
        const result = await api.request('GET', '/non-existent-path');
        expect(result).toEqual({ error: 'Not Found', status: 404 });
    });

    test('request should return 404 for existing path but wrong method', async () => {
        api.register('POST', '/exist', () => {});
        const result = await api.request('GET', '/exist');
        expect(result).toEqual({ error: 'Not Found', status: 404 });
    });
});

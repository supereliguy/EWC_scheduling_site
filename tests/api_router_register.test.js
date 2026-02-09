
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

describe('API Router Registration', () => {
    beforeEach(() => {
        // Reset routes before each test to ensure isolation
        api.routes = {
            GET: {},
            POST: {},
            PUT: {},
            DELETE: {}
        };
    });

    test('register should store a simple route correctly', () => {
        const handler = jest.fn();
        api.register('GET', '/test', handler);

        expect(api.routes.GET['/test']).toBeDefined();
        expect(api.routes.GET['/test'].handler).toBe(handler);
        expect(api.routes.GET['/test'].paramNames).toEqual([]);
    });

    test('register should store a route with one parameter correctly', () => {
        const handler = jest.fn();
        api.register('GET', '/users/:id', handler);

        // Based on implementation: path.replace(/:([^/]+)/g, ...) -> /users/([^/]+)
        const expectedRegex = '/users/([^/]+)';
        expect(api.routes.GET[expectedRegex]).toBeDefined();
        expect(api.routes.GET[expectedRegex].handler).toBe(handler);
        expect(api.routes.GET[expectedRegex].paramNames).toEqual(['id']);
    });

    test('register should store a route with multiple parameters correctly', () => {
        const handler = jest.fn();
        api.register('GET', '/sites/:siteId/users/:userId', handler);

        const expectedRegex = '/sites/([^/]+)/users/([^/]+)';
        expect(api.routes.GET[expectedRegex]).toBeDefined();
        expect(api.routes.GET[expectedRegex].handler).toBe(handler);
        expect(api.routes.GET[expectedRegex].paramNames).toEqual(['siteId', 'userId']);
    });

    test('register should handle different HTTP methods', () => {
        const handler = jest.fn();
        api.register('POST', '/create', handler);
        api.register('DELETE', '/delete', handler);

        expect(api.routes.POST['/create']).toBeDefined();
        expect(api.routes.DELETE['/delete']).toBeDefined();
    });

    test('helper methods (get, post, put, delete) should register routes correctly', () => {
        const handler = jest.fn();

        api.get('/get-route', handler);
        expect(api.routes.GET['/get-route']).toBeDefined();

        api.post('/post-route', handler);
        expect(api.routes.POST['/post-route']).toBeDefined();

        api.put('/put-route', handler);
        expect(api.routes.PUT['/put-route']).toBeDefined();

        api.delete('/delete-route', handler);
        expect(api.routes.DELETE['/delete-route']).toBeDefined();
    });
});

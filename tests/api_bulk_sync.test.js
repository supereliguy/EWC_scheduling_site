
global.window = {
    db: {
        prepare: jest.fn(() => ({
            run: jest.fn(() => ({ changes: 1 })),
        })),
        transaction: jest.fn((cb) => cb),
    }
};

const api = require('../api-router.js');

describe('API Bulk Sync', () => {
    let mockDb;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDb = global.window.db;
    });

    test('should delete existing requests and insert new ones', async () => {
        const runSpy = jest.fn().mockReturnValue({ changes: 1 });
        mockDb.prepare.mockReturnValue({ run: runSpy });

        const requests = [
            { userId: 1, date: '2023-01-01', type: 'off' }, // Upsert
            { userId: 2, date: '2023-01-01', type: null }   // Delete only
        ];

        await api.request('POST', '/api/requests/bulk-sync', { siteId: 1, requests });

        expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM requests WHERE site_id=? AND user_id=? AND date=?');
        expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO requests (site_id, user_id, date, type, shift_id) VALUES (?,?,?,?,?)');

        // 2 Deletes (arguments verify call order/values)
        expect(runSpy).toHaveBeenCalledWith(1, 1, '2023-01-01');
        expect(runSpy).toHaveBeenCalledWith(1, 2, '2023-01-01');

        // 1 Insert
        expect(runSpy).toHaveBeenCalledWith(1, 1, '2023-01-01', 'off', null);
    });
});

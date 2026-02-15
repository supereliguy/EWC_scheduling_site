const scheduler = require('../scheduler.js');
const { checkConstraints } = scheduler;

describe('Scheduler Variance Logic', () => {
    const user = { id: 1, username: 'test' };
    const shift = { id: 1, name: 'Day' };
    const dateStr = '2023-01-01';
    const dateObj = new Date(dateStr);
    const settings = { target_shifts: 10, target_variance: 2 };
    const req = null;
    const weights = { target_variance: 10 };

    test('should allow 12th shift (Soft Limit)', () => {
        const state = { totalAssigned: 11, consecutive: 0, daysOff: 0 };
        const result = checkConstraints(user, shift, dateStr, dateObj, state, settings, req, weights);
        expect(result.valid).toBe(true);
    });

    test('should block 13th shift (Hard Limit)', () => {
        const state = { totalAssigned: 12, consecutive: 0, daysOff: 0 };
        const result = checkConstraints(user, shift, dateStr, dateObj, state, settings, req, weights);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Max Shifts Exceeded');
    });
});

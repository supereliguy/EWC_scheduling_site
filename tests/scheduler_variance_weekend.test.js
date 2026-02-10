const { checkConstraints, calculateScore } = require('../scheduler.js');

describe('New Scheduler Features', () => {
    describe('Max Variance Constraint', () => {
        test('should reject assignment when max variance is exceeded', () => {
            const settings = {
                target_shifts: 10,
                target_variance: 2, // Max = 12
                max_consecutive: 5,
                availability: {}
            };
            const state = {
                totalAssigned: 12, // Already at max
                consecutive: 0
            };
            const shift = { id: 1 };
            const dateObj = new Date();

            const result = checkConstraints({}, shift, '2023-01-01', dateObj, state, settings);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Max Shifts Exceeded');
        });

        test('should allow assignment when within variance', () => {
            const settings = {
                target_shifts: 10,
                target_variance: 2,
                max_consecutive: 5,
                availability: {}
            };
            const state = {
                totalAssigned: 11, // < 12
                consecutive: 0
            };
            const result = checkConstraints({}, { id: 1 }, '2023-01-01', new Date(), state, settings);
            expect(result.valid).toBe(true);
        });
    });

    describe('Weekend Fairness', () => {
        test('should penalize weekend shifts based on accumulated count', () => {
            const settings = { shift_ranking: [], target_shifts: 20, preferred_block_size: 3 };
            const shift = { id: 1, is_weekend: true, name: 'Day' };
            const state = {
                totalAssigned: 5,
                weekendShifts: 0,
                daysOff: 2,
                currentBlockShiftId: 1,
                currentBlockSize: 1
            };

            const scoreLow = calculateScore({}, shift, new Date(), state, settings);
            const scoreHigh = calculateScore({}, shift, new Date(), { ...state, weekendShifts: 5 }, settings);

            expect(scoreHigh).toBeLessThan(scoreLow);
        });

        test('should not penalize non-weekend shifts based on weekend count', () => {
             const settings = { shift_ranking: [], target_shifts: 20, preferred_block_size: 3 };
            const shift = { id: 1, is_weekend: false, name: 'Day' }; // Not weekend
            const state = {
                totalAssigned: 5,
                daysOff: 2,
                currentBlockShiftId: 1,
                currentBlockSize: 1
            };

            const scoreLow = calculateScore({}, shift, new Date(), { ...state, weekendShifts: 0 }, settings);
            const scoreHigh = calculateScore({}, shift, new Date(), { ...state, weekendShifts: 10 }, settings);

            expect(scoreHigh).toBe(scoreLow);
        });
    });
});

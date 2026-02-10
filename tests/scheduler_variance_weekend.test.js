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
        const site = { weekend_start_day: 5, weekend_start_time: '21:00', weekend_end_day: 0, weekend_end_time: '16:00' };

        test('should penalize weekend shifts based on accumulated count', () => {
            const settings = { shift_ranking: [], target_shifts: 20, preferred_block_size: 3 };
            // Saturday is a weekend
            const shift = { id: 1, name: 'Day', start_time: '08:00' };
            const weekendDate = new Date('2023-01-07T12:00:00');

            const state = {
                totalAssigned: 5,
                weekendShifts: 0,
                daysOff: 2,
                currentBlockShiftId: 1,
                currentBlockSize: 1
            };

            const scoreLow = calculateScore({}, shift, weekendDate, state, settings, null, site);
            const scoreHigh = calculateScore({}, shift, weekendDate, { ...state, weekendShifts: 5 }, settings, null, site);

            expect(scoreHigh).toBeLessThan(scoreLow);
        });

        test('should not penalize non-weekend shifts based on weekend count', () => {
             const settings = { shift_ranking: [], target_shifts: 20, preferred_block_size: 3 };
            // Wednesday is not a weekend
            const shift = { id: 1, name: 'Day', start_time: '08:00' };
            const weekdayDate = new Date('2023-01-04T12:00:00');

            const state = {
                totalAssigned: 5,
                daysOff: 2,
                currentBlockShiftId: 1,
                currentBlockSize: 1
            };

            const scoreLow = calculateScore({}, shift, weekdayDate, { ...state, weekendShifts: 0 }, settings, null, site);
            const scoreHigh = calculateScore({}, shift, weekdayDate, { ...state, weekendShifts: 10 }, settings, null, site);

            expect(scoreHigh).toBe(scoreLow);
        });
    });
});

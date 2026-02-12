// tests/scheduler_weekend.test.js
const { isWeekendShift, calculateScore } = require('../scheduler.js');

describe('isWeekendShift', () => {
    // Config: Fri 21:00 - Sun 16:00
    const config = {
        weekend_start_day: 5,
        weekend_start_time: '21:00',
        weekend_end_day: 0,
        weekend_end_time: '16:00'
    };

    test('should identify Fri 22:00 as weekend', () => {
        const date = new Date('2023-01-06T12:00:00'); // Jan 6 2023 is Friday
        const shift = { start_time: '22:00' };
        expect(isWeekendShift(date, shift, config)).toBe(true);
    });

    test('should identify Fri 20:00 as NOT weekend', () => {
        const date = new Date('2023-01-06T12:00:00'); // Fri
        const shift = { start_time: '20:00' };
        expect(isWeekendShift(date, shift, config)).toBe(false);
    });

    test('should identify Sat 08:00 as weekend', () => {
        const date = new Date('2023-01-07T12:00:00'); // Sat
        const shift = { start_time: '08:00' };
        expect(isWeekendShift(date, shift, config)).toBe(true);
    });

    test('should identify Sun 15:00 as weekend', () => {
        const date = new Date('2023-01-08T12:00:00'); // Sun
        const shift = { start_time: '15:00' };
        expect(isWeekendShift(date, shift, config)).toBe(true);
    });

    test('should identify Sun 17:00 as NOT weekend', () => {
        const date = new Date('2023-01-08T12:00:00'); // Sun
        const shift = { start_time: '17:00' };
        expect(isWeekendShift(date, shift, config)).toBe(false);
    });

    test('should identify Mon 08:00 as NOT weekend', () => {
        const date = new Date('2023-01-09T12:00:00'); // Mon
        const shift = { start_time: '08:00' };
        expect(isWeekendShift(date, shift, config)).toBe(false);
    });
});

describe('calculateScore Weekend Penalty', () => {
     const config = {
        weekend_start_day: 5,
        weekend_start_time: '21:00',
        weekend_end_day: 0,
        weekend_end_time: '16:00'
    };

    test('should penalize weekend shift if user has weekend shifts', () => {
        const u = { category_priority: 10 };
        const shift = { id: 1, name: 'Shift', start_time: '22:00' }; // Weekend (Fri night)
        const date = new Date('2023-01-06T12:00:00'); // Fri
        const state = {
            totalAssigned: 0, consecutive: 0, daysOff: 2,
            weekendShifts: 2 // Already worked 2 weekend shifts
        };
        const settings = { target_shifts: 10, shift_ranking: [] };

        // Base score (needed) = 10 * 50 * 1 = 500
        // Penalty = 2 * 5000 (Weight 5) = 10000
        // Net = -9500

        const score = calculateScore(u, shift, date, state, settings, null, config);
        expect(score).toBe(500 - 10000);
    });

    test('should NOT penalize non-weekend shift', () => {
        const u = { category_priority: 10 };
        const shift = { id: 1, name: 'Shift', start_time: '20:00' }; // Fri 20:00 (Not Weekend)
        const date = new Date('2023-01-06T12:00:00'); // Fri
        const state = {
            totalAssigned: 0, consecutive: 0, daysOff: 2,
            weekendShifts: 2
        };
        const settings = { target_shifts: 10, shift_ranking: [] };

        const score = calculateScore(u, shift, date, state, settings, null, config);
        expect(score).toBe(500); // No penalty
    });
});

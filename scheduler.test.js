const { toDateStr, isNightShift } = require('./scheduler');

describe('scheduler.js Utility Functions', () => {

    describe('toDateStr', () => {
        test('should format a date with single digit month and day', () => {
            const date = new Date(2023, 0, 5); // January 5th, 2023 (Month is 0-indexed)
            expect(toDateStr(date)).toBe('2023-01-05');
        });

        test('should format a date with double digit month and day', () => {
            const date = new Date(2023, 10, 15); // November 15th, 2023
            expect(toDateStr(date)).toBe('2023-11-15');
        });

        test('should format a date at the end of the year', () => {
            const date = new Date(2023, 11, 31); // December 31st, 2023
            expect(toDateStr(date)).toBe('2023-12-31');
        });

        test('should handle leap years correctly', () => {
            const date = new Date(2024, 1, 29); // February 29th, 2024
            expect(toDateStr(date)).toBe('2024-02-29');
        });
    });

    describe('isNightShift', () => {
        test('should return false for a standard day shift', () => {
            const shift = { start_time: '08:00', end_time: '16:00' };
            expect(isNightShift(shift)).toBe(false);
        });

        test('should return true for a shift starting after 20:00', () => {
            const shift = { start_time: '20:00', end_time: '04:00' };
            expect(isNightShift(shift)).toBe(true);
        });

        test('should return true for an overnight shift crossing midnight', () => {
            const shift = { start_time: '23:00', end_time: '07:00' };
            expect(isNightShift(shift)).toBe(true);
        });

        test('should return true for a shift starting at 22:00', () => {
             const shift = { start_time: '22:00', end_time: '06:00' };
             expect(isNightShift(shift)).toBe(true);
        });

        test('should use cached isNight property if present', () => {
            // White-box test: If isNight is explicitly true, return true regardless of times
            const shift = { isNight: true, start_time: '08:00', end_time: '16:00' };
            expect(isNightShift(shift)).toBe(true);

            // If explicitly false, return false
            const shift2 = { isNight: false, start_time: '22:00', end_time: '06:00' };
            expect(isNightShift(shift2)).toBe(false);
        });

        test('should handle missing shift object gracefully', () => {
            expect(isNightShift(null)).toBe(false);
            expect(isNightShift(undefined)).toBe(false);
        });

        test('should handle missing time properties gracefully', () => {
            const shift = { name: 'Broken Shift' };
            expect(isNightShift(shift)).toBe(false);
        });

        test('should handle partial time properties gracefully', () => {
             const shift = { start_time: '08:00' }; // missing end_time
             expect(isNightShift(shift)).toBe(false);
        });
    });
});

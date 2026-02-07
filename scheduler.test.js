const { checkConstraints, isNightShift } = require('./scheduler');

describe('checkConstraints - Night to Day Rest Gap', () => {
    // Helper to mock inputs
    const mockUser = { id: 1, username: 'test_user' };

    // Day Shift: 08:00 - 16:00
    const mockDayShift = { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00' };

    // Night Shift: 22:00 - 06:00 (crosses midnight)
    const mockNightShift = { id: 2, name: 'Night', start_time: '22:00', end_time: '06:00' };

    // Late Shift: 20:00 - 04:00 (starts >= 20:00) -> isNightShift true
    const mockLateShift = { id: 3, name: 'Late', start_time: '20:00', end_time: '04:00' };

    const mockSettings = { max_consecutive: 5 };
    const mockDateStr = '2023-01-03';
    // Using a fixed reference time for consistent calculations
    const mockDateObj = new Date('2023-01-03T00:00:00');

    beforeAll(() => {
        // Ensure our assumptions about shifts are correct
        if (!isNightShift(mockNightShift)) throw new Error("Mock Night Shift failed isNightShift check");
        if (!isNightShift(mockLateShift)) throw new Error("Mock Late Shift failed isNightShift check");
        if (isNightShift(mockDayShift)) throw new Error("Mock Day Shift failed isNightShift check (false positive)");
    });

    test('should allow day shift after sufficient rest from night shift (2 days)', () => {
        // Gap = 2 days
        const lastDate = new Date(mockDateObj.getTime() - (2.0 * 24 * 60 * 60 * 1000));

        const state = {
            lastShift: mockNightShift,
            lastDate: lastDate,
            consecutive: 0
        };

        const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

        expect(result.valid).toBe(true);
    });

    test('should fail day shift after insufficient rest from night shift (1.0 days)', () => {
        // Gap = 1.0 days (e.g. Night shift ended morning of Jan 2, next shift starts morning Jan 3?)
        // Note: The logic in scheduler uses date difference.
        // If dates are 2023-01-02 and 2023-01-03, diff is 1.0.
        // Realistically, night shift of Jan 2 ends Jan 3 morning.
        // Day shift of Jan 3 starts Jan 3 morning.
        // So gap is very small.
        // But the scheduler uses assigned DATE.
        // So `gapDays` is diff in assigned dates.

        const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));

        const state = {
            lastShift: mockNightShift,
            lastDate: lastDate,
            consecutive: 0
        };

        const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Inadequate Rest (Night -> Day)');
    });

    test('should fail day shift after insufficient rest from night shift (1.1 days)', () => {
         // Gap = 1.1 days
         // 1.1 * 24h = 26.4 hours.

         const lastDate = new Date(mockDateObj.getTime() - (1.1 * 24 * 60 * 60 * 1000));
         const state = {
             lastShift: mockNightShift,
             lastDate: lastDate,
             consecutive: 0
         };

         const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

         expect(result.valid).toBe(false);
         expect(result.reason).toBe('Inadequate Rest (Night -> Day)');
    });

    test('should allow day shift just after boundary rest (1.11 days)', () => {
         // Gap = 1.11 days
         const lastDate = new Date(mockDateObj.getTime() - (1.11 * 24 * 60 * 60 * 1000));

         const state = {
             lastShift: mockNightShift,
             lastDate: lastDate,
             consecutive: 0
         };

         const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

         expect(result.valid).toBe(true);
    });

    test('should allow day shift after boundary rest (1.2 days)', () => {
         // Gap = 1.2 days
         const lastDate = new Date(mockDateObj.getTime() - (1.2 * 24 * 60 * 60 * 1000));

         const state = {
             lastShift: mockNightShift,
             lastDate: lastDate,
             consecutive: 0
         };

         const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

         expect(result.valid).toBe(true);
    });

    test('should ignore if last shift was not night', () => {
        // Last shift was Day
        const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));

        const state = {
            lastShift: mockDayShift,
            lastDate: lastDate,
            consecutive: 0
        };

        const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, mockSettings, null);

        expect(result.valid).toBe(true);
    });

    test('should ignore if current shift is night', () => {
        // Night -> Night is allowed (consecutive nights are common)
        const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));

        const state = {
            lastShift: mockNightShift,
            lastDate: lastDate,
            consecutive: 0
        };

        // Target is Night
        const result = checkConstraints(mockUser, mockNightShift, mockDateStr, mockDateObj, state, mockSettings, null);

        expect(result.valid).toBe(true);
    });
});

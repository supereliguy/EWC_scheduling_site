const { checkConstraints } = require('./scheduler');

describe('checkConstraints', () => {
    // Shared Mocks
    const mockUser = { id: 1, username: 'test_user' };
    const mockDayShift = { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00' };
    const mockNightShift = { id: 2, name: 'Night', start_time: '22:00', end_time: '06:00' };

    // Jan 3 2023 is a Tuesday
    const mockDateObj = new Date('2023-01-03T00:00:00');
    const mockDateStr = '2023-01-03';

    // Default valid settings
    const baseSettings = {
        max_consecutive: 5,
        availability: { blocked_days: [], blocked_shifts: [] }
    };

    const baseState = {
        consecutive: 0,
        lastShift: null,
        lastDate: null
    };

    describe('Request Off', () => {
        test('should return invalid if user requested off', () => {
            const req = { type: 'off' };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, baseSettings, req);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Requested Off');
        });

        test('should return valid if request is work', () => {
             const req = { type: 'work' };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, baseSettings, req);
             expect(result.valid).toBe(true);
        });

        test('should return valid if no request', () => {
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, baseSettings, null);
             expect(result.valid).toBe(true);
        });
    });

    describe('Availability Rules', () => {
         test('should block if day is in blocked_days', () => {
            // Jan 3 2023 is Tuesday (Day 2)
            const settings = { ...baseSettings, availability: { blocked_days: [2], blocked_shifts: [] } };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, settings, null);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Availability (Day Blocked)');
         });

         test('should allow if day is NOT in blocked_days', () => {
            const settings = { ...baseSettings, availability: { blocked_days: [0, 1, 3, 4, 5, 6], blocked_shifts: [] } };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, settings, null);
            expect(result.valid).toBe(true);
         });

         test('should block if shift is in blocked_shifts', () => {
            const settings = { ...baseSettings, availability: { blocked_days: [], blocked_shifts: [1] } };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, settings, null);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Availability (Shift Blocked)');
         });

         test('should allow if shift is NOT in blocked_shifts', () => {
            const settings = { ...baseSettings, availability: { blocked_days: [], blocked_shifts: [99] } };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, baseState, settings, null);
            expect(result.valid).toBe(true);
         });
    });

    describe('Max Consecutive Shifts', () => {
        test('should return invalid if consecutive limit exceeded', () => {
            const settings = { ...baseSettings, max_consecutive: 3 };
            const state = { ...baseState, consecutive: 3 }; // Next one will be 4
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, settings, null);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Max Consecutive Shifts (3)');
        });

        test('should return valid if consecutive limit not reached', () => {
             const settings = { ...baseSettings, max_consecutive: 3 };
             const state = { ...baseState, consecutive: 2 }; // Next one will be 3 (allowed)
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, settings, null);
             expect(result.valid).toBe(true);
        });
    });

    describe('Strict Circadian (Night -> Day Gap)', () => {
        test('should allow day shift after sufficient rest from night shift (2 days)', () => {
             const lastDate = new Date(mockDateObj.getTime() - (2.0 * 24 * 60 * 60 * 1000));
             const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
             expect(result.valid).toBe(true);
        });

        test('should fail day shift after insufficient rest from night shift (1.0 days)', () => {
             const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));
             const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
             expect(result.valid).toBe(false);
             expect(result.reason).toBe('Inadequate Rest (Night -> Day)');
        });

        test('should fail day shift after insufficient rest from night shift (1.1 days)', () => {
             const lastDate = new Date(mockDateObj.getTime() - (1.1 * 24 * 60 * 60 * 1000));
             const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
             expect(result.valid).toBe(false);
             expect(result.reason).toBe('Inadequate Rest (Night -> Day)');
        });

        test('should allow day shift just after boundary rest (1.11 days)', () => {
             const lastDate = new Date(mockDateObj.getTime() - (1.11 * 24 * 60 * 60 * 1000));
             const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
             expect(result.valid).toBe(true);
        });

        test('should allow day shift after boundary rest (1.2 days)', () => {
             const lastDate = new Date(mockDateObj.getTime() - (1.2 * 24 * 60 * 60 * 1000));
             const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
             const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
             expect(result.valid).toBe(true);
        });

        test('should ignore if last shift was not night', () => {
            const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));
            const state = { lastShift: mockDayShift, lastDate, consecutive: 0 };
            const result = checkConstraints(mockUser, mockDayShift, mockDateStr, mockDateObj, state, baseSettings, null);
            expect(result.valid).toBe(true);
        });

        test('should ignore if current shift is night', () => {
            const lastDate = new Date(mockDateObj.getTime() - (1.0 * 24 * 60 * 60 * 1000));
            const state = { lastShift: mockNightShift, lastDate, consecutive: 0 };
            const result = checkConstraints(mockUser, mockNightShift, mockDateStr, mockDateObj, state, baseSettings, null);
            expect(result.valid).toBe(true);
        });
    });
});

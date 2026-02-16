const { calculateScore } = require('./scheduler');

describe('calculateScore', () => {
    // Shifts
    const shiftDay = { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00' };
    const shiftNight = { id: 2, name: 'Night', start_time: '22:00', end_time: '06:00' };
    const shiftEvening = { id: 3, name: 'Evening', start_time: '14:00', end_time: '22:00' };

    const mockUser = { id: 1, username: 'tester' };
    const mockDateObj = new Date('2023-01-10T00:00:00'); // Some date

    // Default Neutral Settings
    const baseSettings = {
        shift_ranking: [],
        target_shifts: 10,
        target_variance: 2,
        max_consecutive: 5,
        preferred_block_size: 3,
        min_days_off: 2
    };

    // Default Neutral State
    const baseState = {
        totalAssigned: 10, // Match target_shifts to avoid "needed" bonus
        currentBlockShiftId: null,
        currentBlockSize: 0,
        lastShift: null,
        lastDate: null,
        daysOff: 5, // Well rested
        consecutive: 0,
        weekendShifts: 0
    };

    test('Baseline: Returns 0 with neutral inputs', () => {
        const score = calculateScore(mockUser, shiftDay, mockDateObj, baseState, baseSettings, null);
        expect(score).toBe(0);
    });

    describe('Preferences', () => {
        test('Adds 1000 if user requested to work', () => {
            const req = { type: 'work' };
            const score = calculateScore(mockUser, shiftDay, mockDateObj, baseState, baseSettings, req);
            expect(score).toBe(1000);
        });

        test('Does not add 1000 if request is not work (e.g. off)', () => {
            const req = { type: 'off' };
            const score = calculateScore(mockUser, shiftDay, mockDateObj, baseState, baseSettings, req);
            expect(score).toBe(-10000); // Penalty for requesting off
        });
    });

    describe('Shift Ranking', () => {
        const rankSettings = {
            ...baseSettings,
            shift_ranking: ['Day', 'Night', 'Evening'] // Length 3
        };
        // Logic: (length - index) * 100
        // Day: (3 - 0) * 100 = 300
        // Night: (3 - 1) * 100 = 200
        // Evening: (3 - 2) * 100 = 100

        test('Adds score for top ranked shift', () => {
            const score = calculateScore(mockUser, shiftDay, mockDateObj, baseState, rankSettings, null);
            expect(score).toBe(300);
        });

        test('Adds score for middle ranked shift', () => {
            const score = calculateScore(mockUser, shiftNight, mockDateObj, baseState, rankSettings, null);
            expect(score).toBe(200);
        });

        test('Adds score for lowest ranked shift', () => {
            const score = calculateScore(mockUser, shiftEvening, mockDateObj, baseState, rankSettings, null);
            expect(score).toBe(100);
        });

        test('No score if shift not in ranking', () => {
             const weirdShift = { ...shiftDay, name: 'Weird' };
             const score = calculateScore(mockUser, weirdShift, mockDateObj, baseState, rankSettings, null);
             expect(score).toBe(0);
        });
    });

    describe('Target Shifts', () => {
        test('Adds squared points per needed shift (Priority 10)', () => {
            const settings = { ...baseSettings, target_shifts: 10 };
            const state = { ...baseState, totalAssigned: 5 };
            // Needed: 5. Priority: 10 -> Factor 1.
            // Score: 5^2 * 50 * 1 = 1250.
            const score = calculateScore(mockUser, shiftDay, mockDateObj, state, settings, null);
            expect(score).toBe(1250);
        });

        test('Subtracts 50 points per excess shift', () => {
            const settings = { ...baseSettings, target_shifts: 10 };
            const state = { ...baseState, totalAssigned: 12 };
            // Needed: -2. Score: -100.
            // Max Shifts Penalty (12 >= 12): -10000.
            const score = calculateScore(mockUser, shiftDay, mockDateObj, state, settings, null);
            expect(score).toBe(-10100);
        });
    });

    describe('Block Size Logic', () => {
        const blockSettings = { ...baseSettings, preferred_block_size: 3 };

        test('Adds 200 if continuing block and size < preferred', () => {
            const state = {
                ...baseState,
                currentBlockShiftId: shiftDay.id,
                currentBlockSize: 2 // < 3
            };
            // Assigning shiftDay again
            const score = calculateScore(mockUser, shiftDay, mockDateObj, state, blockSettings, null);
            expect(score).toBe(200);
        });

        test('Subtracts points if continuing block but size >= preferred', () => {
            const state = {
                ...baseState,
                currentBlockShiftId: shiftDay.id,
                currentBlockSize: 3 // >= 3
            };
            const score = calculateScore(mockUser, shiftDay, mockDateObj, state, blockSettings, null);
            // Weight 5 / 2 = 2.5 * -1000 = -2500
            expect(score).toBe(-2500);
        });

        test('No impact if switching shifts', () => {
            const state = {
                ...baseState,
                currentBlockShiftId: shiftNight.id, // Different
                currentBlockSize: 2
            };
            const score = calculateScore(mockUser, shiftDay, mockDateObj, state, blockSettings, null);
            expect(score).toBe(0);
        });
    });

    describe('Soft Circadian Rhythm', () => {
        // Night -> Day gap <= 3 days penalizes -5000 (Weight 5)
        const lastDate = new Date(mockDateObj.getTime() - (2 * 24 * 60 * 60 * 1000)); // 2 days ago
        const nightShiftWithMeta = { ...shiftNight, isNight: true };
        const dayShiftWithMeta = { ...shiftDay, isNight: false };

        test('Penalizes Night -> Day transition with short gap', () => {
            const state = {
                ...baseState,
                lastShift: nightShiftWithMeta,
                lastDate: lastDate
            };
            // Trying to assign Day shift
            const score = calculateScore(mockUser, dayShiftWithMeta, mockDateObj, state, baseSettings, null);
            expect(score).toBe(-5000);
        });

        test('No penalty if gap > 3 days', () => {
             const oldDate = new Date(mockDateObj.getTime() - (4 * 24 * 60 * 60 * 1000)); // 4 days ago
             const state = {
                 ...baseState,
                 lastShift: nightShiftWithMeta,
                 lastDate: oldDate
             };
             const score = calculateScore(mockUser, dayShiftWithMeta, mockDateObj, state, baseSettings, null);
             expect(score).toBe(0);
        });
    });

    describe('Min Days Off', () => {
         const offSettings = { ...baseSettings, min_days_off: 3 };

         test('Penalizes -10000 if returning to work too early', () => {
             // User has been off for 1 day, but needs 3.
             // daysOff > 0 && daysOff < min
             const state = {
                 ...baseState,
                 daysOff: 1
             };
             const score = calculateScore(mockUser, shiftDay, mockDateObj, state, offSettings, null);
             expect(score).toBe(-10000);
         });

         test('No penalty if user was working yesterday (daysOff = 0)', () => {
             const state = {
                 ...baseState,
                 daysOff: 0
             };
             const score = calculateScore(mockUser, shiftDay, mockDateObj, state, offSettings, null);
             expect(score).toBe(0);
         });

         test('No penalty if user has been off long enough', () => {
             const state = {
                 ...baseState,
                 daysOff: 3 // >= min
             };
             const score = calculateScore(mockUser, shiftDay, mockDateObj, state, offSettings, null);
             expect(score).toBe(0);
         });
    });
});

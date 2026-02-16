
const { checkConstraintsBiDirectional, buildAssignmentIndex, isNightShift } = require('../scheduler');

// Mock Data
const mockUser = { id: 1, username: 'tester' };
const shiftDay = { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00' };
const shiftNight = { id: 2, name: 'Night', start_time: '22:00', end_time: '06:00', isNight: true };
const shiftLate = { id: 3, name: 'Late', start_time: '14:00', end_time: '23:00' };

const dateStr = '2023-01-04'; // Wednesday
const dateObj = new Date(dateStr + 'T00:00:00');

// Default Weights
const defaultWeights = {
    max_consecutive: 10,
    min_days_off: 10,
    min_rest_hours: 10,
    circadian_strict: 10
};

describe('Bi-Directional Constraints', () => {

    test('Max Consecutive: Detects violation bridging two blocks', () => {
        // Mon, Tue WORK. Wed (Target). Thu, Fri WORK.
        // Max = 4. Total would be 5.
        const assignments = [
            { userId: 1, date: '2023-01-02', shiftId: 1, shift: shiftDay }, // Mon
            { userId: 1, date: '2023-01-03', shiftId: 1, shift: shiftDay }, // Tue
            // Wed Empty
            { userId: 1, date: '2023-01-05', shiftId: 1, shift: shiftDay }, // Thu
            { userId: 1, date: '2023-01-06', shiftId: 1, shift: shiftDay }  // Fri
        ];
        const index = buildAssignmentIndex(assignments);
        const settings = { max_consecutive: 4 };

        const result = checkConstraintsBiDirectional(mockUser, shiftDay, dateStr, dateObj, index, settings, null, defaultWeights, null, 0);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Max Consecutive');
    });

    test('Max Consecutive: Valid if bridging stays within limit', () => {
        // Mon WORK. Wed (Target). Fri WORK.
        // Total = 1 + 1 + 1 = 3. Max = 4.
        const assignments = [
            { userId: 1, date: '2023-01-02', shiftId: 1, shift: shiftDay },
            { userId: 1, date: '2023-01-06', shiftId: 1, shift: shiftDay }
        ];
        const index = buildAssignmentIndex(assignments);
        const settings = { max_consecutive: 4 };

        const result = checkConstraintsBiDirectional(mockUser, shiftDay, dateStr, dateObj, index, settings, null, defaultWeights, null, 0);
        expect(result.valid).toBe(true);
    });

    test('Min Rest: Detects violation from Previous day (Reverse filling)', () => {
        // Tue: Night (Ends Wed 06:00). Wed: Day (Starts 08:00). Gap 2h.
        // If we fill Wed Day, and Tue Night is already there.
        const assignments = [
            { userId: 1, date: '2023-01-03', shiftId: 2, shift: shiftNight, shiftObj: shiftNight }
        ];
        const index = buildAssignmentIndex(assignments);
        const settings = { min_rest_hours: 12 };

        const result = checkConstraintsBiDirectional(mockUser, shiftDay, dateStr, dateObj, index, settings, null, defaultWeights, null, 0);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Inadequate Rest');
    });

    test('Min Rest: Detects violation from Next day (Forward checking)', () => {
        // Wed: Night (Ends Thu 06:00). Thu: Day (Starts 08:00).
        // If we fill Wed Night, and Thu Day is already there.
        const assignments = [
            { userId: 1, date: '2023-01-05', shiftId: 1, shift: shiftDay, shiftObj: shiftDay } // Thu
        ];
        const index = buildAssignmentIndex(assignments);
        const settings = { min_rest_hours: 12 };

        // Target: Wed Night
        const result = checkConstraintsBiDirectional(mockUser, shiftNight, dateStr, dateObj, index, settings, null, defaultWeights, null, 0);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Inadequate Rest');
    });

    test('Circadian Strict: Night then Day', () => {
        // Tue Night. Wed Day.
        const assignments = [
             { userId: 1, date: '2023-01-03', shiftId: 2, shift: shiftNight, shiftObj: shiftNight }
        ];
        const index = buildAssignmentIndex(assignments);
        const settings = {}; // Default weight 10

        const result = checkConstraintsBiDirectional(mockUser, shiftDay, dateStr, dateObj, index, settings, null, defaultWeights, null, 0);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Inadequate Rest'); // Circadian strict triggers Inadequate Rest message in my impl
    });

    test('Min Days Off: Filling a gap makes it too small', () => {
        // Work Mon, Tue. (Gap Wed). Work Thu, Fri.
        // Gap is 1 day. Min is 2.
        // Wait, if I fill Wed, gap is 0. That's fine (continuous work).
        // But if I have: Mon Work. Tue Off. Wed Off. Thu Work.
        // Gap is 2.
        // If I fill Tue.
        // Mon Work. Tue Work. Wed Off. Thu Work.
        // Gap becomes 1 (Wed). Violation!

        const assignments = [
            { userId: 1, date: '2023-01-02', shiftId: 1, shift: shiftDay }, // Mon
            { userId: 1, date: '2023-01-05', shiftId: 1, shift: shiftDay }  // Thu
        ];
        // Target: Tue '2023-01-03'
        const targetDate = new Date('2023-01-03T00:00:00');
        const targetStr = '2023-01-03';

        const index = buildAssignmentIndex(assignments);
        const settings = { min_days_off: 2 };

        const result = checkConstraintsBiDirectional(mockUser, shiftDay, targetStr, targetDate, index, settings, null, defaultWeights, null, 0);

        // Before: Gap (Tue, Wed) = 2. Valid.
        // After filling Tue: Gap (Wed) = 1. Invalid.
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Min Days Off');
    });

});

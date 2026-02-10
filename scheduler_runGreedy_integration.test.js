const { runGreedy } = require('./scheduler');

describe('runGreedy Integration Tests', () => {
    // Shared Mocks
    const mockShifts = [
        { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }
    ];
    // User 1 & 2 are identical initially
    const mockUsers = [
        { id: 1, username: 'user1', role: 'user', category_priority: 10 },
        { id: 2, username: 'user2', role: 'user', category_priority: 10 }
    ];

    const baseSettings = {
        max_consecutive: 5,
        target_shifts: 20,
        min_days_off: 2,
        shift_ranking: [],
        availability: { blocked_days: [], blocked_shifts: [] },
        night_preference: 0.5,
        target_shifts_variance: 2,
        preferred_block_size: 3
    };

    const mockUserSettings = {
        1: { ...baseSettings },
        2: { ...baseSettings }
    };

    const startObj = new Date('2023-01-01T00:00:00'); // Sunday

    describe('State Tracking & Constraints', () => {
        test('should limit consecutive shifts according to max_consecutive setting', () => {
            // User 1 has max_consecutive = 3
            const settings = {
                1: { ...baseSettings, max_consecutive: 3 },
                2: { ...baseSettings, max_consecutive: 3 }
            };

            // Only User 1 is available
            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 5,
                shifts: mockShifts,
                users: [mockUsers[0]],
                userSettings: settings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            const assignedDays = result.assignments.map(a => a.date);
            // Should work Day 1, 2, 3
            expect(assignedDays).toContain('2023-01-01');
            expect(assignedDays).toContain('2023-01-02');
            expect(assignedDays).toContain('2023-01-03');
            // Should NOT work Day 4 (would be 4th consecutive)
            expect(assignedDays).not.toContain('2023-01-04');
        });

        test('should prioritize min_days_off (soft constraint) when alternative exists', () => {
             // User 1 works 3 days. min_days_off = 2.
             // User 2 is fresh.
             // Day 4: User 1 has penalty (-2000). User 2 has 0 penalty.
             // User 2 should be picked.

             const settings = {
                1: { ...baseSettings, max_consecutive: 3, min_days_off: 2 },
                2: { ...baseSettings, max_consecutive: 3, min_days_off: 2 }
             };

             // Force User 1 to work Day 1, 2, 3 via Locking (to ensure state)
             const locked = [
                { date: '2023-01-01', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day' },
                { date: '2023-01-02', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day' },
                { date: '2023-01-03', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day' }
             ];

             const result = runGreedy({
                siteId: 1,
                startObj,
                days: 5,
                shifts: mockShifts,
                users: mockUsers, // Both available
                userSettings: settings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: locked,
                forceMode: false
             });

             const assigned = result.assignments;
             // Day 4 should be User 2
             const day4 = assigned.find(a => a.date === '2023-01-04');
             expect(day4).toBeDefined();
             expect(day4.userId).toBe(2);

             // Day 5 should also be User 2 (User 1 still needs 2 days off?
             // Day 4 was off. Day 5 is 2nd day off. So User 1 penalty is gone on Day 6)
             // On Day 5, User 1 has daysOff=1. min=2. Penalty!
             // User 2 has daysOff=0 (worked Day 4). Penalty? No, consecutive=1.

             const day5 = assigned.find(a => a.date === '2023-01-05');
             expect(day5).toBeDefined();
             expect(day5.userId).toBe(2);
        });

        test('should respect days_of_week filtering', () => {
            // Shift only on Mondays (Day 1)
            // 2023-01-01 is Sunday (0). 2023-01-02 is Monday (1).
            const specificShift = { ...mockShifts[0], days_of_week: '1' };

            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 2, // Sun, Mon
                shifts: [specificShift],
                users: mockUsers,
                userSettings: mockUserSettings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            const assigned = result.assignments;
            const sun = assigned.find(a => a.date === '2023-01-01');
            const mon = assigned.find(a => a.date === '2023-01-02');

            expect(sun).toBeUndefined(); // Shift not allowed on Sunday
            expect(mon).toBeDefined(); // Shift allowed on Monday
        });
    });

    describe('Locked Assignments', () => {
        test('should include locked assignments in consecutive count', () => {
            // User 1 locked on Day 1 & 2. max_consecutive = 3.
            // Can work Day 3. Cannot work Day 4.
            const settings = { 1: { ...baseSettings, max_consecutive: 3 } };

            const locked = [
                { date: '2023-01-01', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day' },
                { date: '2023-01-02', shift_id: 1, user_id: 1, is_locked: 1, shift_name: 'Day' }
            ];

            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 4,
                shifts: mockShifts,
                users: [mockUsers[0]],
                userSettings: settings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: locked,
                forceMode: false
            });

            const assigned = result.assignments;
            const day3 = assigned.find(a => a.date === '2023-01-03');
            const day4 = assigned.find(a => a.date === '2023-01-04');

            expect(day3).toBeDefined();
            expect(day3.isLocked).toBe(false);

            expect(day4).toBeUndefined(); // 4th consecutive
        });
    });

    describe('Scoring & Prioritization', () => {
        test('should prioritize user with work request (+1000)', () => {
            // User 1 requests Work. User 2 Neutral.
            const requests = [{ user_id: 1, date: '2023-01-01', type: 'work' }];

            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 1,
                shifts: mockShifts,
                users: mockUsers,
                userSettings: mockUserSettings,
                requests,
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            expect(result.assignments[0].userId).toBe(1);
        });

        test('should avoid user with off request if possible (Strict constraint)', () => {
            // User 1 requests Off. User 2 Neutral.
            // User 1 should NOT be assigned because 'off' is a hard constraint checkConstraints() returns valid: false
            const requests = [{ user_id: 1, date: '2023-01-01', type: 'off' }];

            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 1,
                shifts: mockShifts,
                users: mockUsers, // Both 1 and 2
                userSettings: mockUserSettings,
                requests,
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            expect(result.assignments[0].userId).toBe(2);
        });

        test('should prioritize user needed to meet target shifts', () => {
             // User 1 has high target. User 2 has low target.
             const settings = {
                 1: { ...baseSettings, target_shifts: 100 }, // Needs more
                 2: { ...baseSettings, target_shifts: 0 }    // Needs less
             };

             const result = runGreedy({
                siteId: 1,
                startObj,
                days: 1,
                shifts: mockShifts,
                users: mockUsers,
                userSettings: settings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            // Score adds (needed * 10). User 1 gets +1000. User 2 gets 0.
            expect(result.assignments[0].userId).toBe(1);
        });
    });

    describe('Circadian Rhythm (Night -> Day)', () => {
        const shiftNight = { id: 2, name: 'Night', start_time: '22:00', end_time: '06:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' };

        test('should prevent Night -> Day assignment with short gap', () => {
             // Day 1: Night. Day 2: Day.
             // Gap is small (< 1 day). Hard Constraint.

             // Force User 1 to work Night on Day 1 (Locked)
             const locked = [{
                 date: '2023-01-01',
                 shift_id: 2, // Night
                 user_id: 1,
                 is_locked: 1,
                 shift_name: 'Night',
                 start_time: '22:00', end_time: '06:00'
             }];

             // Provide User 2 to fill Day 1 Day Shift so we don't get failure for it
             // And User 2 can also compete for Day 2 Day Shift? No, let's keep User 2 busy or just ignore Day 1 failure.

             // Easier: Just check Day 2.
             const result = runGreedy({
                siteId: 1,
                startObj,
                days: 2,
                shifts: [mockShifts[0]], // Only Day shifts available for filling (Night is locked)
                users: [mockUsers[0]],
                userSettings: mockUserSettings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: locked,
                forceMode: false
             });

             const assigned = result.assignments;

             // Day 2 should NOT be assigned Day shift due to 'Inadequate Rest'
             // If User 1 is the only user, and they are invalid, assignment fails.
             expect(assigned.find(a => a.date === '2023-01-02')).toBeUndefined();

             // Find failure for Day 2
             const failureDay2 = result.conflictReport.find(c => c.date === '2023-01-02');
             expect(failureDay2).toBeDefined();

             const failureReason = failureDay2.failures.find(f => f.username === 'user1');
             expect(failureReason.reason).toContain('Rest');
        });
    });
});

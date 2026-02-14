const { runGreedy } = require('../scheduler');

describe('Scheduler Fill First Priority', () => {
    // 1 Shift, 1 Slot
    const mockShifts = [{
        id: 1,
        name: 'Day',
        start_time: '08:00',
        end_time: '16:00',
        required_staff: 1,
        days_of_week: '0,1,2,3,4,5,6'
    }];

    const startObj = new Date('2023-01-01'); // Sunday (Day 0)

    test('Fill First user should win against Backfill user even with lower score', () => {
        // User A: Fill First = true. No preference (Score ~0 + needed bonus)
        // User B: Fill First = false. High preference (Score boosted)
        const mockUsers = [
            { id: 1, username: 'FillFirstUser', fill_first: 1, category_priority: 10 },
            { id: 2, username: 'BackfillUser', fill_first: 0, category_priority: 1 } // Priority 1 gives huge score boost normally
        ];

        // Give User B a massive advantage in score via priority weighting
        // Priority 1 -> Factor 10 -> Score += 500 per needed shift
        // Priority 10 -> Factor 1 -> Score += 50 per needed shift
        // User B should score much higher than User A.

        const mockUserSettings = {
            1: {
                max_consecutive: 5, target_shifts: 1,
                shift_ranking: [],
                availability: { blocked_days: [], blocked_shifts: [] }
            },
            2: {
                max_consecutive: 5, target_shifts: 1,
                shift_ranking: [],
                availability: { blocked_days: [], blocked_shifts: [] }
            }
        };

        // Run multiple times to ensure randomization doesn't affect it
        for (let i = 0; i < 20; i++) {
            const result = runGreedy({
                siteId: 1,
                startObj,
                days: 1,
                shifts: mockShifts,
                users: mockUsers,
                userSettings: mockUserSettings,
                requests: [],
                prevAssignments: [],
                lockedAssignments: [],
                forceMode: false
            });

            const assignment = result.assignments[0];
            expect(assignment).toBeDefined();
            expect(assignment.userId).toBe(1); // User A (Fill First) must win
        }
    });

    test('Fill First users compete among themselves by score', () => {
        // User A: Fill First, Low Priority
        // User B: Fill First, High Priority
        const mockUsers = [
            { id: 1, username: 'FillFirst_Low', fill_first: 1, category_priority: 10 },
            { id: 2, username: 'FillFirst_High', fill_first: 1, category_priority: 1 }
        ];

        const mockUserSettings = {
            1: { max_consecutive: 5, target_shifts: 1 },
            2: { max_consecutive: 5, target_shifts: 1 }
        };

        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: mockUsers,
            userSettings: mockUserSettings,
            requests: [],
            prevAssignments: [],
            lockedAssignments: [],
            forceMode: false
        });

        const assignment = result.assignments[0];
        expect(assignment).toBeDefined();
        // Since both are Fill First, the one with higher score (Priority 1) should win
        expect(assignment.userId).toBe(2);
    });

    test('Backfill user gets shift if Fill First user is unavailable', () => {
        const mockUsers = [
            { id: 1, username: 'FillFirstUser', fill_first: 1, category_priority: 10 },
            { id: 2, username: 'BackfillUser', fill_first: 0, category_priority: 10 }
        ];

        const mockUserSettings = {
            1: {
                max_consecutive: 5, target_shifts: 1,
                availability: { blocked_days: [0], blocked_shifts: [] } // Blocked on Sunday (Day 0)
            },
            2: {
                max_consecutive: 5, target_shifts: 1,
                availability: { blocked_days: [], blocked_shifts: [] }
            }
        };

        const result = runGreedy({
            siteId: 1,
            startObj, // Sunday
            days: 1,
            shifts: mockShifts,
            users: mockUsers,
            userSettings: mockUserSettings,
            requests: [],
            prevAssignments: [],
            lockedAssignments: [],
            forceMode: false
        });

        const assignment = result.assignments[0];
        expect(assignment).toBeDefined();
        expect(assignment.userId).toBe(2); // Backfill gets it because FillFirst is blocked
    });
});

const { runGreedy } = require('./scheduler');

describe('runGreedy Force Mode Logic', () => {
    // Mock Data
    const mockShifts = [
        { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }
    ];

    const startObj = new Date('2023-01-01'); // Sunday

    test('should prioritize sacrificing users with higher priority number (lower importance)', () => {
        const users = [
            { id: 1, username: 'HighImportance', role: 'user', category_priority: 1 },  // Priority 1
            { id: 2, username: 'LowImportance', role: 'user', category_priority: 10 } // Priority 10
        ];

        // Both blocked
        const userSettings = {
            1: { max_consecutive: 5, target_shifts: 5, shift_ranking: [], availability: { blocked_shifts: [1] } },
            2: { max_consecutive: 5, target_shifts: 5, shift_ranking: [], availability: { blocked_shifts: [1] } }
        };

        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users,
            userSettings,
            requests: [],
            prevAssignments: [],
            lockedAssignments: [],
            forceMode: true
        });

        expect(result.assignments).toHaveLength(1);
        // Expect User 2 (Priority 10) to be sacrificed because 10 > 1 (higher number = lower importance)
        expect(result.assignments[0].userId).toBe(2);

        // Verify it was recorded as a conflict
        expect(result.conflictReport).toHaveLength(1);
        expect(result.conflictReport[0].userId).toBe(2);
        expect(result.conflictReport[0].reason).toContain('Forced: Availability (Shift Blocked)');
    });

    test('should distribute hits fairly among equal priority users', () => {
        const users = [
            { id: 3, username: 'Equal1', role: 'user', category_priority: 10 },
            { id: 4, username: 'Equal2', role: 'user', category_priority: 10 }
        ];

        const userSettings = {
            3: { max_consecutive: 5, target_shifts: 5, availability: { blocked_shifts: [1] } },
            4: { max_consecutive: 5, target_shifts: 5, availability: { blocked_shifts: [1] } }
        };

        // Run for 2 days
        const startObj2 = new Date('2023-01-02'); // Monday
        const result = runGreedy({
            siteId: 1,
            startObj: startObj2,
            days: 2,
            shifts: mockShifts,
            users,
            userSettings,
            requests: [],
            prevAssignments: [],
            lockedAssignments: [],
            forceMode: true
        });

        expect(result.assignments).toHaveLength(2);

        const day1 = result.assignments.find(a => a.date === '2023-01-02');
        const day2 = result.assignments.find(a => a.date === '2023-01-03');

        expect(day1).toBeDefined();
        expect(day2).toBeDefined();

        // One user assigned Day 1, the OTHER assigned Day 2 (because first user has hit count 1)
        expect(day1.userId).not.toBe(day2.userId);
    });

    test('should fail to assign if forceMode is false and constraints exist', () => {
        const users = [
            { id: 1, username: 'HighImportance', role: 'user', category_priority: 1 },
            { id: 2, username: 'LowImportance', role: 'user', category_priority: 10 }
        ];

        // Both blocked
        const userSettings = {
            1: { max_consecutive: 5, target_shifts: 5, availability: { blocked_shifts: [1] } },
            2: { max_consecutive: 5, target_shifts: 5, availability: { blocked_shifts: [1] } }
        };

        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users,
            userSettings,
            requests: [],
            prevAssignments: [],
            lockedAssignments: [],
            forceMode: false // Strict mode
        });

        expect(result.assignments).toHaveLength(0);
        expect(result.conflictReport).toHaveLength(1);
        // Should report failures for the shift
        expect(result.conflictReport[0].failures).toHaveLength(2);
    });
});

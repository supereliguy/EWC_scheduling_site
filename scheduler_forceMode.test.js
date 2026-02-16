const { runGreedy } = require('./scheduler');

describe('runGreedy Force Mode Logic', () => {
    // Mock Data
    const mockShifts = [
        { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }
    ];

    const startObj = new Date('2023-01-01'); // Sunday

    test('should NOT force assign users if they violate Hard Constraints', () => {
        const users = [
            { id: 1, username: 'User1', role: 'user', category_priority: 1 },
            { id: 2, username: 'User2', role: 'user', category_priority: 10 }
        ];

        // Both blocked (Hard Constraint)
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
            forceMode: true
        });

        // Expect NO assignments
        expect(result.assignments).toHaveLength(0);

        // Verify Conflict Report
        expect(result.conflictReport).toHaveLength(1);
        expect(result.conflictReport[0].failures).toHaveLength(2);
        expect(result.conflictReport[0].failures[0].reason).toContain('Availability');
    });

    test('should assign users if constraints are Soft', () => {
        const users = [
            { id: 1, username: 'User1', role: 'user', category_priority: 10 }
        ];

        // Blocked but Soft Weight passed
        const userSettings = {
            1: { max_consecutive: 5, target_shifts: 5, availability: { blocked_shifts: [1] } }
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
            forceMode: true,
            ruleWeights: { availability: 5 } // Soft
        });

        // Expect Assignment (Normal candidate path)
        expect(result.assignments).toHaveLength(1);
        expect(result.assignments[0].userId).toBe(1);
        // Not a forced hit (isHit undefined or false)
        expect(result.assignments[0].isHit).toBeFalsy();
    });
});

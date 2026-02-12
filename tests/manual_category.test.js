const { runGreedy } = require('../scheduler');

describe('runGreedy Manual Category', () => {
    // Basic Mock Data
    const mockShifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
    const mockUsers = [
        { id: 1, username: 'auto_user', is_manual: 0, category_priority: 10 },
        { id: 2, username: 'manual_user', is_manual: 1, category_priority: 10 }
    ];
    const mockUserSettings = {
        1: { max_consecutive: 5, target_shifts: 5, shift_ranking: [] },
        2: { max_consecutive: 5, target_shifts: 5, shift_ranking: [] }
    };
    const mockRequests = [];
    const mockPrevAssignments = [];
    const mockLockedAssignments = [];
    const startObj = new Date('2023-01-01');

    test('should NOT assign shifts to manual users', () => {
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: mockUsers,
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: mockLockedAssignments,
            forceMode: true // Force to ensure it tries to fill slots
        });

        // Should assign to auto_user
        const assignments = result.assignments.filter(a => !a.isLocked);
        const assignedUserIds = assignments.map(a => a.userId);

        expect(assignedUserIds).toContain(1); // Auto user should be assigned
        expect(assignedUserIds).not.toContain(2); // Manual user should NOT be assigned
    });

    test('should respect manual user locked assignments', () => {
        // Pre-lock manual user
        const locked = [{
            site_id: 1,
            date: '2023-01-01',
            shift_id: 1,
            user_id: 2, // Manual User
            is_locked: 1,
            shift_name: 'Day'
        }];

        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: mockUsers,
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: locked,
            forceMode: true
        });

        // The locked assignment should persist
        const manualAssignments = result.assignments.filter(a => a.userId === 2);
        expect(manualAssignments.length).toBe(1);
        expect(manualAssignments[0].isLocked).toBe(true);

        // Auto user should NOT be assigned because slot is filled by locked manual user
        // Shift requires 1 staff, and it's taken.
        const autoAssignments = result.assignments.filter(a => a.userId === 1);
        expect(autoAssignments.length).toBe(0);
    });
});

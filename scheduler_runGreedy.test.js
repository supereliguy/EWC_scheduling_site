const { runGreedy } = require('./scheduler');

describe('runGreedy Robustness', () => {
    // Basic Mock Data
    const mockShifts = [{ id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' }];
    const mockUsers = [{ id: 1, username: 'user1' }];
    const mockUserSettings = { 1: { max_consecutive: 5, target_shifts: 5, shift_ranking: [] } };
    const mockRequests = [];
    const mockPrevAssignments = [];
    const mockLockedAssignments = [];
    const startObj = new Date('2023-01-01');

    test('should run successfully with valid inputs', () => {
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
            forceMode: false
        });
        expect(result).toBeDefined();
        expect(result.assignments).toBeInstanceOf(Array);
        expect(result.conflictReport).toBeInstanceOf(Array);
    });

    test('should handle empty user list gracefully', () => {
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: [], // Empty
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: mockLockedAssignments,
            forceMode: false
        });
        // Expect conflict report because slots exist but no users
        expect(result.conflictReport.length).toBeGreaterThan(0);
        expect(result.assignments).toHaveLength(0);
    });

    test('should handle missing users (undefined) without crashing', () => {
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: undefined, // Missing
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: mockLockedAssignments,
            forceMode: false
        });
        // Should treat as empty list
        expect(result.conflictReport.length).toBeGreaterThan(0);
        expect(result.assignments).toHaveLength(0);
    });

    test('should handle missing users (null) without crashing', () => {
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: null, // Null
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: mockLockedAssignments,
            forceMode: false
        });
        expect(result.conflictReport.length).toBeGreaterThan(0);
        expect(result.assignments).toHaveLength(0);
    });

    test('should handle missing lockedAssignments without crashing', () => {
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts,
            users: mockUsers,
            userSettings: mockUserSettings,
            requests: mockRequests,
            prevAssignments: mockPrevAssignments,
            lockedAssignments: undefined, // Missing
            forceMode: false
        });
        expect(result.assignments).toBeDefined();
    });

    test('should handle completely missing optional arguments', () => {
        // Minimal call
        const result = runGreedy({
            siteId: 1,
            startObj,
            days: 1,
            shifts: mockShifts
            // Missing users, settings, requests, assignments
        });
        expect(result.assignments).toBeDefined();
        // Should report conflicts as no users available
        expect(result.conflictReport.length).toBeGreaterThan(0);
    });
});

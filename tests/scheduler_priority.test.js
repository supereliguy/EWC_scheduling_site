const { runGreedy } = require('../scheduler');

describe('Scheduler Priority', () => {
    // Setup minimal mock data
    const shift = { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1, days_of_week: '0,1,2,3,4,5,6' };
    const users = [
        { id: 1, username: 'VIP', category_priority: 1 }, // High Priority
        { id: 2, username: 'Normie', category_priority: 10 } // Low Priority
    ];
    const userSettings = {
        1: { target_shifts: 10, target_variance: 2, max_consecutive: 5, min_days_off: 2, shift_ranking: [] },
        2: { target_shifts: 10, target_variance: 2, max_consecutive: 5, min_days_off: 2, shift_ranking: [] }
    };

    test('High priority user should win over low priority user when both need shifts', () => {
        // Run greedy for 1 day
        const result = runGreedy({
            siteId: 1,
            startObj: new Date('2023-01-01'),
            days: 1,
            shifts: [shift],
            users: users,
            userSettings: userSettings,
            requests: [],
            requestsMap: {},
            prevAssignments: [],
            lockedAssignments: []
        });

        // The single shift should go to VIP (User 1) because they have higher priority (1 vs 10)
        // Score calc:
        // VIP: needed(10) * 50 * (11-1=10) = 5000
        // Normie: needed(10) * 50 * (11-10=1) = 500

        expect(result.assignments.length).toBe(1);
        expect(result.assignments[0].userId).toBe(1);
    });

    test('Low priority user requesting work vs High priority user needing shifts', () => {
        // Normie requests work (+1000 preference)
        const requests = [{ user_id: 2, date: '2023-01-01', type: 'work' }];
        const requestsMap = { '2023-01-01': { 2: requests[0] } };

        const result = runGreedy({
            siteId: 1,
            startObj: new Date('2023-01-01'),
            days: 1,
            shifts: [shift],
            users: users,
            userSettings: userSettings,
            requests: requests,
            requestsMap: requestsMap,
            prevAssignments: [],
            lockedAssignments: []
        });

        // VIP Score: 5000 (from above)
        // Normie Score: 500 (Base) + 1000 (Request) = 1500
        // VIP should still win (5000 > 1500)
        // This confirms my logic that Needs > Preferences for VIPs.

        expect(result.assignments.length).toBe(1);
        expect(result.assignments[0].userId).toBe(1);
    });

    test('Low priority user requesting work vs Low priority user needing shifts', () => {
       // Two normies
       const users2 = [
           { id: 2, username: 'Normie1', category_priority: 10 },
           { id: 3, username: 'Normie2', category_priority: 10 }
       ];
       const settings2 = {
           2: { target_shifts: 10, shift_ranking: [] },
           3: { target_shifts: 10, shift_ranking: [] }
       };
       // Normie2 requests work
       const requests = [{ user_id: 3, date: '2023-01-01', type: 'work' }];
       const requestsMap = { '2023-01-01': { 3: requests[0] } };

       const result = runGreedy({
           siteId: 1,
           startObj: new Date('2023-01-01'),
           days: 1,
           shifts: [shift],
           users: users2,
           userSettings: settings2,
           requests, requestsMap
       });

       // Normie1 Score: 10 * 50 * 1 = 500
       // Normie2 Score: 10 * 50 * 1 = 500 + 1000 (Request) = 1500
       // Normie2 should win due to request
       expect(result.assignments[0].userId).toBe(3);
    });
});

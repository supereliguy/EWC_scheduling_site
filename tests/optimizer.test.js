const { test, describe, it } = require('node:test');
const assert = require('node:assert');
const Optimizer = require('../src/lib/optimizer');

describe('Optimizer Logic', () => {
    const mockShifts = [
        { id: 1, name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1 },
        { id: 2, name: 'Night', start_time: '20:00', end_time: '06:00', required_staff: 1 }
    ];

    const mockUsers = [
        { id: 1, username: 'Alice', role: 'user' },
        { id: 2, username: 'Bob', role: 'user' }
    ];

    const defaultSettings = {
        1: { max_consecutive: 3, min_days_off: 2, night_pref: 1.0 },
        2: { max_consecutive: 3, min_days_off: 2, night_pref: 1.0 }
    };

    const defaultState = {
        1: { consecutiveShifts: 0, daysOff: 2, totalAssigned: 0 },
        2: { consecutiveShifts: 0, daysOff: 2, totalAssigned: 0 }
    };

    it('should respect "off" requests', () => {
        const requests = [{ user_id: 1, date: '2023-10-01', type: 'off' }];
        const optimizer = new Optimizer({
            shifts: [mockShifts[0]],
            users: mockUsers,
            userSettings: defaultSettings,
            requests: requests,
            initialState: defaultState,
            year: 2023,
            month: 10
        });

        // We only simulate one day to force a choice.
        // If Alice requests off, Bob must be picked.
        // We can access runGreedy directly or check internal logic.
        // Let's modify daysInMonth to 1 for this test by passing a custom endDate logic?
        // Actually, the class calculates daysInMonth. So we run for the whole month but only care about day 1.

        const { assignments } = optimizer.solve(10);
        const day1Assignment = assignments.find(a => a.date === '2023-10-01');

        assert.ok(day1Assignment, 'Someone should be assigned');
        assert.strictEqual(day1Assignment.userId, 2, 'Bob should be assigned because Alice requested off');
    });

    it('should penalize breaking min_days_off', () => {
        // Alice worked yesterday (Day 0), so consecutive=1, daysOff=0.
        // Bob was off yesterday (Day 0), so consecutive=0, daysOff=1.
        // Min Days Off is 2.
        // If Bob works Day 1, his daysOff was 1 (which is > 0 and < 2). Violation!
        // Alice working Day 1 is fine (consecutive 2 < 3).

        const state = {
            1: { consecutiveShifts: 1, daysOff: 0, totalAssigned: 0 },
            2: { consecutiveShifts: 0, daysOff: 1, totalAssigned: 0 }
        };

        const optimizer = new Optimizer({
            shifts: [mockShifts[0]],
            users: mockUsers,
            userSettings: defaultSettings,
            requests: [],
            initialState: state,
            year: 2023,
            month: 10
        });

        // Force the algorithm to pick one for Day 1.
        // Alice should be picked because Bob working would be a violation (-2000 score).

        const { assignments } = optimizer.solve(10);
        const day1Assignment = assignments.find(a => a.date === '2023-10-01');

        assert.strictEqual(day1Assignment.userId, 1, 'Alice should be assigned because Bob needs rest');
    });

    it('should respect night preference', () => {
        // Alice Loves Nights (2.0)
        // Bob Hates Nights (0.1)
        const settings = {
            1: { max_consecutive: 5, min_days_off: 2, night_pref: 2.0 },
            2: { max_consecutive: 5, min_days_off: 2, night_pref: 0.1 }
        };

        const optimizer = new Optimizer({
            shifts: [mockShifts[1]], // Only Night shift
            users: mockUsers,
            userSettings: settings,
            requests: [],
            initialState: defaultState,
            year: 2023,
            month: 10
        });

        const { assignments } = optimizer.solve(10);
        // Check assignments for first few days. Alice should take them all mostly,
        // until fairness or consecutive kicks in.

        const day1 = assignments.find(a => a.date === '2023-10-01');
        assert.strictEqual(day1.userId, 1, 'Alice should get the night shift');
    });
});


const scheduler = require('./scheduler.js');
const { checkConstraints } = scheduler;

// Mock context objects
const user = { id: 1, username: 'testuser' };
const shift = { id: 10, name: 'Shift A' };
const dateStr = '2023-10-02'; // A Monday
const dateObj = new Date(dateStr); // Monday

// Helper to get base settings
const getSettings = (avail = {}) => ({
    target_shifts: 10,
    target_variance: 2,
    max_consecutive: 5,
    availability: avail
});

test('should pass if no constraints', () => {
    const settings = getSettings({ blocked_shift_days: [] });
    const result = checkConstraints(user, shift, dateStr, dateObj, { totalAssigned: 0, consecutive: 0 }, settings, undefined);
    expect(result.valid).toBe(true);
});

test('should block specific shift on specific day', () => {
    // 10-1 means Shift 10 on Monday (Day 1)
    const settings = getSettings({ blocked_shift_days: ['10-1'] });
    const result = checkConstraints(user, shift, dateStr, dateObj, { totalAssigned: 0, consecutive: 0 }, settings, undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Availability (Shift Blocked on Day)');
});

test('should allow specific shift on different day', () => {
    // Block on Tuesday (10-2), but check Monday (10-1)
    const settings = getSettings({ blocked_shift_days: ['10-2'] });
    const result = checkConstraints(user, shift, dateStr, dateObj, { totalAssigned: 0, consecutive: 0 }, settings, undefined);
    expect(result.valid).toBe(true);
});

test('should block with old global shift block', () => {
    const settings = getSettings({ blocked_shifts: [10] });
    const result = checkConstraints(user, shift, dateStr, dateObj, { totalAssigned: 0, consecutive: 0 }, settings, undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Availability (Shift Blocked)');
});

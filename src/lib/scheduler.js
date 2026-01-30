const db = require('../db');
const Optimizer = require('./optimizer');

const toDateStr = (d) => {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

const generateSchedule = async ({ siteId, month, year }) => {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month

    // 1. Fetch Data

    // Fetch last 7 days of previous month for history
    const prevMonthEnd = new Date(year, month - 1, 0);
    const prevMonthStart = new Date(prevMonthEnd);
    prevMonthStart.setDate(prevMonthEnd.getDate() - 6); // 7 days window

    const prevAssignments = db.prepare(`
        SELECT * FROM assignments
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(siteId, toDateStr(prevMonthStart), toDateStr(prevMonthEnd));

    const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);
    const users = db.prepare('SELECT id, username, role FROM users').all();

    // Fetch settings
    const settingsRows = db.prepare('SELECT * FROM user_settings').all();
    const userSettings = {};
    users.forEach(u => {
        const s = settingsRows.find(r => r.user_id === u.id) || {};
        userSettings[u.id] = {
            max_consecutive: s.max_consecutive_shifts || 5,
            min_days_off: s.min_days_off || 2,
            night_pref: s.night_preference !== undefined ? s.night_preference : 1.0
        };
    });

    const requests = db.prepare(`
        SELECT user_id, date, type FROM requests
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(siteId, toDateStr(startDate), toDateStr(endDate));

    // 2. Calculate Initial State
    const initialState = {};
    users.forEach(u => {
        let consecutive = 0;
        let daysOff = 0;

        // Walk backwards from prevMonthEnd
        // We have 7 days history.
        // check date prevMonthEnd, then -1, etc.
        let findingConsecutive = true;
        let findingDaysOff = true;

        for (let i = 0; i < 7; i++) {
            const d = new Date(prevMonthEnd);
            d.setDate(prevMonthEnd.getDate() - i);
            const dStr = toDateStr(d);

            const worked = prevAssignments.some(a => a.user_id === u.id && a.date === dStr);

            if (i === 0) {
                // If worked last day, daysOff = 0, consecutive >= 1
                if (worked) {
                    findingDaysOff = false;
                    consecutive++;
                } else {
                    findingConsecutive = false;
                    daysOff++;
                }
            } else {
                if (findingConsecutive && worked) {
                    consecutive++;
                } else {
                    findingConsecutive = false;
                }

                if (findingDaysOff && !worked) {
                    daysOff++;
                } else {
                    findingDaysOff = false;
                }
            }
        }

        // Default fallbacks if history is empty (new users or no history)
        if (daysOff === 0 && consecutive === 0) daysOff = 99; // Assume fully rested if unknown

        initialState[u.id] = {
            consecutiveShifts: consecutive,
            daysOff: daysOff,
            totalAssigned: 0
        };
    });

    // 3. Run Optimizer
    const optimizer = new Optimizer({
        shifts,
        users,
        userSettings,
        requests,
        initialState,
        year,
        month
    });

    const { assignments: bestSchedule } = optimizer.solve();

    // 4. Save
    const transaction = db.transaction(() => {
        // Delete draft for this month
        const startStr = toDateStr(startDate);
        const endStr = toDateStr(endDate);
        db.prepare('DELETE FROM assignments WHERE site_id = ? AND date BETWEEN ? AND ? AND status = ?')
          .run(siteId, startStr, endStr, 'draft');

        const insert = db.prepare('INSERT INTO assignments (site_id, date, shift_id, user_id, status) VALUES (?, ?, ?, ?, ?)');
        for (const assign of bestSchedule) {
             insert.run(siteId, assign.date, assign.shiftId, assign.userId, 'draft');
        }
    });

    transaction();

    // Transform for API response
    const assignmentsWithDetails = bestSchedule.map(a => {
        const shift = shifts.find(s => s.id === a.shiftId);
        const user = users.find(u => u.id === a.userId);
        return {
            date: a.date,
            shift: shift ? shift.name : '?',
            user: user ? user.username : '?'
        };
    });

    return { assignments: assignmentsWithDetails };
};

module.exports = { generateSchedule };

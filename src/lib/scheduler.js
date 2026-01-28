const db = require('../db');

const toDateStr = (d) => {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

const generateSchedule = async ({ siteId, month, year }) => {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const daysInMonth = endDate.getDate();

    // Fetch Data
    // We ideally should look at previous month assignments for continuity.
    // Fetch last 7 days of previous month.
    const prevMonthEnd = new Date(year, month - 1, 0);
    const prevMonthStart = new Date(prevMonthEnd);
    prevMonthStart.setDate(prevMonthEnd.getDate() - 6);

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

    // 2. Algorithm: Randomized Greedy with Restarts
    const ITERATIONS = 50;
    let bestSchedule = null;
    let bestScore = -Infinity;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = runGreedy({
            siteId, month, year, daysInMonth,
            shifts, users, userSettings, requests, prevAssignments, prevMonthEnd
        });

        if (result.score > bestScore) {
            bestScore = result.score;
            bestSchedule = result.assignments;
        }
    }

    if (!bestSchedule) {
        throw new Error("Could not generate a valid schedule. Check constraints.");
    }

    // 3. Save
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

const runGreedy = ({ siteId, month, year, daysInMonth, shifts, users, userSettings, requests, prevAssignments, prevMonthEnd }) => {
    let assignments = []; // {date, shiftId, userId}
    let totalScore = 0;

    // Initialize User State from Previous Month
    const userState = {};
    users.forEach(u => {
        // Simple history check: Did they work the absolute last day of previous month?
        // Assignments array has dates YYYY-MM-DD.
        // prevMonthEnd is Date object.
        const lastDayStr = toDateStr(prevMonthEnd);
        const workedLastDay = prevAssignments.some(a => a.user_id === u.id && a.date === lastDayStr);

        userState[u.id] = {
            consecutiveShifts: workedLastDay ? 1 : 0, // Very basic approx
            daysOff: workedLastDay ? 0 : 1,
            totalAssigned: 0
        };
    });

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        // Shuffle users to randomize who gets picked if scores equal
        const shuffledUsers = [...users].sort(() => Math.random() - 0.5);

        const dayAssignments = new Set(); // userIds assigned today

        for (const shift of shifts) {
            const isNight = shift.end_time < shift.start_time;
            const required = shift.required_staff;

            // Score candidates
            const candidates = shuffledUsers.filter(u => !dayAssignments.has(u.id))
                .map(u => {
                    const req = requests.find(r => r.user_id === u.id && r.date === dateStr);
                    if (req && req.type === 'off') return null; // Hard constraint: Requested Off

                    const state = userState[u.id];
                    const settings = userSettings[u.id];
                    let score = 0;

                    // Preferences
                    if (req && req.type === 'work') score += 1000;

                    // Night Preference
                    if (isNight) {
                        // Pref > 1 (e.g. 1.5) -> Bonus. Pref < 1 (e.g. 0.5) -> Penalty.
                        score += (settings.night_pref - 1) * 100;
                    } else {
                        // Day shift.
                        // If pref > 1 (likes nights), penalty for day? Or just neutral?
                        // Let's say if you HATE nights (0.1), you LIKE days.
                        // (0.1 - 1) = -0.9.  -( -0.9 ) = +0.9 bonus for day.
                        score -= (settings.night_pref - 1) * 50;
                    }

                    // Constraints

                    // 1. Max Consecutive
                    // If assigned, consecutive becomes +1.
                    if (state.consecutiveShifts + 1 > settings.max_consecutive) {
                        score -= 5000; // Strong soft constraint
                    } else if (state.consecutiveShifts + 1 === settings.max_consecutive) {
                        score -= 50; // Discourage hitting limit
                    }

                    // 2. Min Days Off
                    // If I work today (daysOff becomes 0).
                    // This is bad ONLY IF I just finished a block and haven't rested enough.
                    // i.e. I was OFF yesterday (daysOff > 0).
                    // AND daysOff < min_days_off.
                    if (state.daysOff > 0 && state.daysOff < settings.min_days_off) {
                        score -= 2000; // Did not rest enough
                    }

                    // Fairness (Equalize total shifts)
                    score -= state.totalAssigned * 10;

                    // Admin bonus (legacy from old code, maybe keep?)
                    // if (u.role === 'admin') score += 5;

                    return { user: u, score };
                })
                .filter(c => c !== null);

            candidates.sort((a, b) => b.score - a.score);
            const selected = candidates.slice(0, required);

            for (const { user, score } of selected) {
                assignments.push({ date: dateStr, shiftId: shift.id, userId: user.id });
                dayAssignments.add(user.id);
                totalScore += score;
            }
        }

        // Update State for next day
        users.forEach(u => {
            if (dayAssignments.has(u.id)) {
                userState[u.id].consecutiveShifts++;
                userState[u.id].daysOff = 0;
                userState[u.id].totalAssigned++;
            } else {
                userState[u.id].consecutiveShifts = 0;
                userState[u.id].daysOff++;
            }
        });
    }

    return { assignments, score: totalScore };
};

module.exports = { generateSchedule };

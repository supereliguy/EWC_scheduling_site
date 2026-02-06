const db = require('../db');

const toDateStr = (d) => {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

const isNightShift = (shift) => {
    // Heuristic: If it crosses midnight (end < start) OR starts very late (e.g. > 20:00)
    if (!shift) return false;
    const s = parseInt(shift.start_time.split(':')[0]);
    const e = parseInt(shift.end_time.split(':')[0]);
    return e < s || s >= 20;
};

const getShiftType = (shift) => shift ? shift.name : null;

const generateSchedule = async ({ siteId, month, year }) => {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const daysInMonth = endDate.getDate();

    // 1. Fetch Data

    // Previous Month (last 7 days) for continuity
    const prevMonthEnd = new Date(year, month - 1, 0);
    const prevMonthStart = new Date(prevMonthEnd);
    prevMonthStart.setDate(prevMonthEnd.getDate() - 6);

    const prevAssignments = db.prepare(`
        SELECT a.*, s.name as shift_name, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
    `).all(siteId, toDateStr(prevMonthStart), toDateStr(prevMonthEnd));

    // Locked Assignments for Current Month
    const lockedAssignments = db.prepare(`
        SELECT a.*, s.name as shift_name, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ? AND a.is_locked = 1
    `).all(siteId, toDateStr(startDate), toDateStr(endDate));

    const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);

    // Get users for this site only
    const users = db.prepare(`
        SELECT u.id, u.username, u.role
        FROM users u
        JOIN site_users su ON u.id = su.user_id
        WHERE su.site_id = ?
    `).all(siteId);

    // Fetch settings
    const settingsRows = db.prepare('SELECT * FROM user_settings').all();
    const userSettings = {};
    users.forEach(u => {
        const s = settingsRows.find(r => r.user_id === u.id) || {};
        let shiftRanking = [];
        try { shiftRanking = JSON.parse(s.shift_ranking || '[]'); } catch(e) {}

        userSettings[u.id] = {
            max_consecutive: s.max_consecutive_shifts || 5,
            min_days_off: s.min_days_off || 2,
            night_pref: s.night_preference !== undefined ? s.night_preference : 1.0,
            target_shifts: s.target_shifts || 20,
            target_variance: s.target_shifts_variance || 2,
            preferred_block_size: s.preferred_block_size || 3,
            shift_ranking: shiftRanking
        };
    });

    const requests = db.prepare(`
        SELECT user_id, date, type FROM requests
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(siteId, toDateStr(startDate), toDateStr(endDate));

    // 2. Algorithm: Randomized Greedy with Restarts
    const ITERATIONS = 100;
    let bestSchedule = null;
    let bestScore = -Infinity;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = runGreedy({
            siteId, month, year, daysInMonth,
            shifts, users, userSettings, requests,
            prevAssignments, lockedAssignments
        });

        // Basic check: Did we fill all required slots?
        // Actually, we might not be able to if constraints are tight.
        // We prefer a valid schedule with gaps over an invalid one?
        // Or we prioritize score.
        if (result.score > bestScore) {
            bestScore = result.score;
            bestSchedule = result.assignments;
        }
    }

    if (!bestSchedule) {
        throw new Error("Could not generate a valid schedule.");
    }

    // 3. Save
    const transaction = db.transaction(() => {
        // Delete NON-LOCKED assignments for this month
        const startStr = toDateStr(startDate);
        const endStr = toDateStr(endDate);
        db.prepare('DELETE FROM assignments WHERE site_id = ? AND date BETWEEN ? AND ? AND is_locked = 0')
          .run(siteId, startStr, endStr);

        const insert = db.prepare('INSERT INTO assignments (site_id, date, shift_id, user_id, status, is_locked) VALUES (?, ?, ?, ?, ?, 0)');
        for (const assign of bestSchedule) {
             // Skip if it was already locked (it's already in DB)
             if (!assign.isLocked) {
                 insert.run(siteId, assign.date, assign.shiftId, assign.userId, 'draft');
             }
        }
    });

    transaction();

    return { assignments: bestSchedule }; // Returns mixed list, but UI reloads anyway
};

const runGreedy = ({ siteId, month, year, daysInMonth, shifts, users, userSettings, requests, prevAssignments, lockedAssignments }) => {
    let assignments = [...lockedAssignments.map(a => ({
        date: a.date,
        shiftId: a.shift_id,
        userId: a.user_id,
        isLocked: true,
        shiftName: a.shift_name,
        shiftObj: a // Keep full shift object for heuristics
    }))];

    let totalScore = 0;

    // Initialize User State
    const userState = {};
    users.forEach(u => {
        // Reconstruct history from prevAssignments
        // We need: consecutive shifts, days off, last shift type, last shift date

        // Find last worked day in prevAssignments
        const myPrev = prevAssignments.filter(a => a.user_id === u.id).sort((a,b) => new Date(a.date) - new Date(b.date));

        let consecutive = 0;
        let daysOff = 0;
        let lastShift = null;
        let lastDate = null;

        // Trace back from day 0 backwards? Or just simulate forward?
        // Simpler: Just look at the very last assignment.
        if (myPrev.length > 0) {
            const last = myPrev[myPrev.length - 1];
            lastShift = last;
            lastDate = new Date(last.date);

            // Calculate gap to Month Start (Day 1)
            const monthStart = new Date(year, month - 1, 1);
            const gap = (monthStart - lastDate) / (1000 * 60 * 60 * 24);

            if (gap <= 1) {
                daysOff = 0;
                // Count consecutive backwards
                consecutive = 1;
                for(let i = myPrev.length - 2; i >= 0; i--) {
                    const curr = new Date(myPrev[i].date);
                    const next = new Date(myPrev[i+1].date);
                    if ((next - curr) / (1000 * 60 * 60 * 24) === 1) {
                        consecutive++;
                    } else {
                        break;
                    }
                }
            } else {
                daysOff = Math.floor(gap) - 1; // if last worked 28th, and today is 1st. 29,30,31 off.
                consecutive = 0;
            }
        } else {
            daysOff = 99; // Long time off
        }

        userState[u.id] = {
            consecutive,
            daysOff,
            lastShift, // Shift Object
            lastDate,  // Date Object
            totalAssigned: 0,
            currentBlockShiftId: lastShift ? lastShift.shift_id : null,
            currentBlockSize: consecutive // Approx
        };
    });

    // Helper to update state
    const updateState = (uId, dateStr, shift, isWorked) => {
        const s = userState[uId];
        const date = new Date(dateStr);

        if (isWorked) {
            s.totalAssigned++;
            if (s.daysOff === 0) {
                s.consecutive++;
            } else {
                s.consecutive = 1;
            }
            s.daysOff = 0;

            if (s.currentBlockShiftId === shift.id) {
                s.currentBlockSize++;
            } else {
                s.currentBlockShiftId = shift.id;
                s.currentBlockSize = 1;
            }

            s.lastShift = shift;
            s.lastDate = date;
        } else {
            s.consecutive = 0;
            s.daysOff++;
            s.currentBlockSize = 0;
            s.currentBlockShiftId = null;
        }
    };

    // Iterate Days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const dateObj = new Date(dateStr);

        // Identify who is already locked today
        const lockedToday = assignments.filter(a => a.date === dateStr);
        const lockedUserIds = new Set(lockedToday.map(a => a.userId));

        // Update state for locked users FIRST?
        // No, we should process shifts, and if a shift is locked, we just skip "assigning" it but we record it.
        // Actually, easiest is: For each shift type required, check if locked users satisfy it.
        // If locked user has Shift A, they fill a slot for Shift A.

        // However, `shifts` loop drives the assignment.
        // Let's create a "Slots to Fill" map.
        const slotsToFill = [];
        shifts.forEach(s => {
            const lockedForThisShift = lockedToday.filter(a => a.shiftId === s.id);
            const needed = Math.max(0, s.required_staff - lockedForThisShift.length);
            for(let k=0; k<needed; k++) slotsToFill.push(s);
        });

        // Process Locked Users State Update (Critical for constraints validation)
        lockedToday.forEach(a => {
            // Find the shift object
            const sObj = shifts.find(s => s.id === a.shiftId) || a.shiftObj; // Fallback
            updateState(a.userId, dateStr, sObj, true);
        });

        // Now fill remaining slots
        const shuffledUsers = [...users].sort(() => Math.random() - 0.5);
        const assignedToday = new Set(lockedUserIds); // Track who is working today

        for (const shift of slotsToFill) {
            const candidates = shuffledUsers.filter(u => !assignedToday.has(u.id))
                .map(u => {
                    // Check Hard Constraints
                    const state = userState[u.id];
                    const settings = userSettings[u.id];
                    const req = requests.find(r => r.user_id === u.id && r.date === dateStr);

                    if (req && req.type === 'off') return null;

                    // 1. Max Consecutive
                    if (state.consecutive + 1 > settings.max_consecutive) return null; // Hard limit

                    // 2. Strict Circadian (Last was Night, Today is Day/Early)
                    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
                        // Check gap.
                        // If yesterday was last worked:
                        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
                        if (gapDays <= 1.1) { // 1 day diff
                             return null; // Forbidden Night -> Day
                        }
                    }

                    // Score
                    let score = 0;

                    // 3. Preferences
                    if (req && req.type === 'work') score += 1000;

                    // Shift Ranking
                    const rankIndex = settings.shift_ranking.indexOf(shift.name);
                    if (rankIndex !== -1) {
                         score += (settings.shift_ranking.length - rankIndex) * 50; // Top rank gets most points
                    }

                    // 4. Targets
                    const needed = settings.target_shifts - state.totalAssigned;
                    score += needed * 10;

                    // 5. Block Size
                    if (state.currentBlockShiftId === shift.id) {
                        if (state.currentBlockSize < settings.preferred_block_size) {
                            score += 200; // Encourage continuing block
                        } else {
                            score -= 100; // Encourage breaking block
                        }
                    }

                    // 6. Soft Circadian (Night -> Day < 72h)
                    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
                         const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
                         if (gapDays <= 3) {
                             score -= 500; // Penalize
                         }
                    }

                    // 7. Min Days Off (If I worked recently and haven't rested enough)
                    // If daysOff > 0 (just came off work), check if daysOff < min_days_off
                    if (state.daysOff > 0 && state.daysOff < settings.min_days_off) {
                         score -= 2000; // Strong penalty (almost hard constraint)
                    }

                    return { user: u, score };
                })
                .filter(c => c !== null);

            candidates.sort((a, b) => b.score - a.score);

            if (candidates.length > 0) {
                const selected = candidates[0];
                assignments.push({
                    date: dateStr,
                    shiftId: shift.id,
                    userId: selected.user.id,
                    isLocked: false
                });
                assignedToday.add(selected.user.id);
                totalScore += selected.score;
                updateState(selected.user.id, dateStr, shift, true);
            } else {
                totalScore -= 10000; // Failed to fill slot
            }
        }

        // Update state for those OFF today
        users.forEach(u => {
            if (!assignedToday.has(u.id)) {
                updateState(u.id, dateStr, null, false);
            }
        });
    }

    return { assignments, score: totalScore };
};

module.exports = { generateSchedule };

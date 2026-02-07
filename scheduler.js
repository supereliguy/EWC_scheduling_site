// scheduler.js - Converted to ES Module-like syntax for browser, using global 'db' object

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

// We attach to window so it can be called by api-router
const generateSchedule = async ({ siteId, startDate, days, force }) => {
    // Access global db wrapper
    // Check if window.db exists, otherwise use global db (for testing if mocked globally)
    const db = (typeof window !== 'undefined' && window.db) ? window.db : global.db;

    // Parse start date from string YYYY-MM-DD to local Date
    const [y, m, d] = startDate.split('-').map(Number);
    const startObj = new Date(y, m - 1, d);

    const endObj = new Date(startObj);
    endObj.setDate(startObj.getDate() + days - 1);

    // 1. Fetch Data

    // Previous Context (last 7 days before start)
    const contextEnd = new Date(startObj);
    contextEnd.setDate(contextEnd.getDate() - 1);
    const contextStart = new Date(contextEnd);
    contextStart.setDate(contextStart.getDate() - 6);

    const prevAssignments = db.prepare(`
        SELECT a.*, s.name as shift_name, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
    `).all(siteId, toDateStr(contextStart), toDateStr(contextEnd));

    // Locked Assignments for Target Period
    const lockedAssignments = db.prepare(`
        SELECT a.*, s.name as shift_name, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ? AND a.is_locked = 1
    `).all(siteId, toDateStr(startObj), toDateStr(endObj));

    const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);

    // Get users for this site only (join with categories)
    const users = db.prepare(`
        SELECT u.id, u.username, u.role,
               COALESCE(cat.priority, 10) as category_priority,
               cat.name as category_name
        FROM users u
        JOIN site_users su ON u.id = su.user_id
        LEFT JOIN user_categories cat ON su.category_id = cat.id
        WHERE su.site_id = ?
    `).all(siteId);

    // Fetch settings
    const settingsRows = db.prepare('SELECT * FROM user_settings').all();

    // Fetch Global Settings
    const globalRows = db.prepare('SELECT * FROM global_settings').all();
    const globalSettings = {};
    globalRows.forEach(r => globalSettings[r.key] = r.value);
    const g = {
        max_consecutive: parseInt(globalSettings.max_consecutive_shifts) || 5,
        min_days_off: parseInt(globalSettings.min_days_off) || 2,
        night_pref: parseFloat(globalSettings.night_preference) || 1.0,
        target_shifts: parseInt(globalSettings.target_shifts) || 20,
        target_variance: parseInt(globalSettings.target_shifts_variance) || 2,
        preferred_block_size: parseInt(globalSettings.preferred_block_size) || 3
    };

    const userSettings = {};
    users.forEach(u => {
        const s = settingsRows.find(r => r.user_id === u.id) || {};
        let shiftRanking = [];
        try { shiftRanking = JSON.parse(s.shift_ranking || '[]'); } catch(e) {}

        userSettings[u.id] = {
            max_consecutive: s.max_consecutive_shifts !== undefined ? s.max_consecutive_shifts : g.max_consecutive,
            min_days_off: s.min_days_off !== undefined ? s.min_days_off : g.min_days_off,
            night_pref: s.night_preference !== undefined ? s.night_preference : g.night_pref,
            target_shifts: s.target_shifts !== undefined ? s.target_shifts : g.target_shifts,
            target_variance: s.target_shifts_variance !== undefined ? s.target_shifts_variance : g.target_variance,
            preferred_block_size: s.preferred_block_size !== undefined ? s.preferred_block_size : g.preferred_block_size,
            shift_ranking: shiftRanking
        };
    });

    const requests = db.prepare(`
        SELECT user_id, date, type FROM requests
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(siteId, toDateStr(startObj), toDateStr(endObj));

    // 2. Algorithm: Randomized Greedy with Restarts
    const ITERATIONS = force ? 1 : 100; // If forcing, just do one run? Or maybe still try a few to optimize 'hits'? Let's do fewer for force to avoid heavy compute if it's struggling.
    // Actually, if force is true, we WANT to find the path of least resistance (fewest hits). So iterations are still good.
    // But if force is false, we fail fast? No, we try to find a valid one.

    let bestResult = null;
    let bestScore = -Infinity;

    for (let i = 0; i < ITERATIONS; i++) {
        const result = runGreedy({
            siteId, startObj, days,
            shifts, users, userSettings, requests,
            prevAssignments, lockedAssignments,
            forceMode: !!force
        });

        if (result.score > bestScore) {
            bestScore = result.score;
            bestResult = result;
        }
    }

    if (!bestResult) {
        throw new Error("Could not generate a schedule.");
    }

    // 3. Save (Only if NOT a dry run? No, we always save, but if it has conflicts, the user might reject it?)
    // The user flow is: Generate -> See Conflicts -> Force.
    // So if force is false and we have conflicts, we return them but DO NOT SAVE?
    // Or we save the partial?
    // User said: "Stop at the initial fail... give me list of problems... then click proceed".
    // So we should NOT save if conflicts exist and force is false.

    const hasUnfilled = bestResult.assignments.length < (days * shifts.reduce((acc,s)=>acc+s.required_staff,0)) - (bestResult.conflictReport ? 0 : 0); // Logic check?
    // Better check: did we fail to fill any slots?
    // The conflictReport contains failures for unfilled slots.
    const conflicts = bestResult.conflictReport || [];
    const isComplete = conflicts.length === 0;

    if (force || isComplete) {
        const transaction = db.transaction(() => {
            // Delete NON-LOCKED assignments for this period
            const startStr = toDateStr(startObj);
            const endStr = toDateStr(endObj);
            db.prepare('DELETE FROM assignments WHERE site_id = ? AND date BETWEEN ? AND ? AND is_locked = 0')
              .run(siteId, startStr, endStr);

            const insert = db.prepare('INSERT INTO assignments (site_id, date, shift_id, user_id, status, is_locked) VALUES (?, ?, ?, ?, ?, 0)');
            for (const assign of bestResult.assignments) {
                 // Skip if it was already locked (it's already in DB)
                 if (!assign.isLocked) {
                     insert.run(siteId, assign.date, assign.shiftId, assign.userId, 'draft');
                 }
            }
        });
        transaction();
    }

    return {
        assignments: bestResult.assignments,
        conflictReport: bestResult.conflictReport,
        success: isComplete
    };
};

const checkConstraints = (u, shift, dateStr, dateObj, state, settings, req) => {
    // 0. Request Off (Hardest Constraint usually)
    if (req && req.type === 'off') return { valid: false, reason: 'Requested Off' };

    // 1. Max Consecutive
    if (state.consecutive + 1 > settings.max_consecutive) return { valid: false, reason: `Max Consecutive Shifts (${settings.max_consecutive})` };

    // 2. Strict Circadian (Night -> Day gap)
    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
        if (gapDays <= 1.1) {
             return { valid: false, reason: 'Inadequate Rest (Night -> Day)' };
        }
    }

    return { valid: true, score: 0 };
};

const calculateScore = (u, shift, dateObj, state, settings, req) => {
    let score = 0;
    // 3. Preferences
    if (req && req.type === 'work') score += 1000;

    const rankIndex = settings.shift_ranking.indexOf(shift.name);
    if (rankIndex !== -1) {
            score += (settings.shift_ranking.length - rankIndex) * 50;
    }

    // 4. Targets
    const needed = settings.target_shifts - state.totalAssigned;
    score += needed * 10;

    // 5. Block Size
    if (state.currentBlockShiftId === shift.id) {
        if (state.currentBlockSize < settings.preferred_block_size) {
            score += 200;
        } else {
            score -= 100;
        }
    }

    // 6. Soft Circadian
    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
        if (gapDays <= 3) {
             score -= 500;
        }
    }

    // 7. Min Days Off
    if (state.daysOff > 0 && state.daysOff < settings.min_days_off) {
            score -= 2000;
    }

    return score;
};

const runGreedy = ({ siteId, startObj, days, shifts, users, userSettings, requests, prevAssignments, lockedAssignments, forceMode }) => {
    let assignments = [...lockedAssignments.map(a => ({
        date: a.date,
        shiftId: a.shift_id,
        userId: a.user_id,
        isLocked: true,
        shiftName: a.shift_name,
        shiftObj: a // Keep full shift object
    }))];

    let totalScore = 0;
    const conflictReport = [];

    // Initialize User State
    const userState = {};
    users.forEach(u => {
        // Find last worked day in prevAssignments
        const myPrev = prevAssignments.filter(a => a.user_id === u.id).sort((a,b) => new Date(a.date) - new Date(b.date));

        let consecutive = 0;
        let daysOff = 0;
        let lastShift = null;
        let lastDate = null;

        if (myPrev.length > 0) {
            const last = myPrev[myPrev.length - 1];
            lastShift = last;
            lastDate = new Date(last.date);
            const gap = (startObj - lastDate) / (1000 * 60 * 60 * 24);

            if (gap <= 1) {
                daysOff = 0;
                consecutive = 1; // Simplification
                // Iterate back for accurate consecutive
                for(let i = myPrev.length - 2; i >= 0; i--) {
                    const curr = new Date(myPrev[i].date);
                    const next = new Date(myPrev[i+1].date);
                    if ((next - curr) / (1000 * 60 * 60 * 24) === 1) {
                        consecutive++;
                    } else { break; }
                }
            } else {
                daysOff = Math.floor(gap) - 1;
                consecutive = 0;
            }
        } else {
            daysOff = 99;
        }

        userState[u.id] = {
            consecutive,
            daysOff,
            lastShift,
            lastDate,
            totalAssigned: 0,
            hits: 0,
            currentBlockShiftId: lastShift ? lastShift.shift_id : null,
            currentBlockSize: consecutive
        };
    });

    const updateState = (uId, dateObj, shift, isWorked) => {
        const s = userState[uId];
        if (isWorked) {
            s.totalAssigned++;
            if (s.daysOff === 0) s.consecutive++;
            else s.consecutive = 1;
            s.daysOff = 0;

            if (s.currentBlockShiftId === shift.id) s.currentBlockSize++;
            else {
                s.currentBlockShiftId = shift.id;
                s.currentBlockSize = 1;
            }
            s.lastShift = shift;
            s.lastDate = dateObj;
        } else {
            s.consecutive = 0;
            s.daysOff++;
            s.currentBlockSize = 0;
            s.currentBlockShiftId = null;
        }
    };

    for (let i = 0; i < days; i++) {
        const dateObj = new Date(startObj);
        dateObj.setDate(startObj.getDate() + i);
        const dateStr = toDateStr(dateObj);

        const lockedToday = assignments.filter(a => a.date === dateStr);
        const lockedUserIds = new Set(lockedToday.map(a => a.userId));

        // State update for locked
        lockedToday.forEach(a => {
            const sObj = shifts.find(s => s.id === a.shiftId) || a.shiftObj;
            updateState(a.userId, dateObj, sObj, true);
        });

        // Slots to fill
        const slotsToFill = [];
        shifts.forEach(s => {
            const lockedForThisShift = lockedToday.filter(a => a.shiftId === s.id);
            const needed = Math.max(0, s.required_staff - lockedForThisShift.length);
            for(let k=0; k<needed; k++) slotsToFill.push(s);
        });

        const assignedToday = new Set(lockedUserIds);
        const shuffledUsers = [...users].sort(() => Math.random() - 0.5);

        for (const shift of slotsToFill) {
            const candidates = [];

            // 1. Strict Check
            shuffledUsers.forEach(u => {
                if (assignedToday.has(u.id)) return;
                const state = userState[u.id];
                const settings = userSettings[u.id];
                const req = requests.find(r => r.user_id === u.id && r.date === dateStr);

                const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);
                if (check.valid) {
                    // Add score
                    const score = calculateScore(u, shift, dateObj, state, settings, req);
                    candidates.push({ user: u, score, reason: null });
                }
            });

            // Sort candidates by score
            candidates.sort((a, b) => b.score - a.score);

            if (candidates.length > 0) {
                // Assign Best
                const selected = candidates[0];
                assignments.push({
                    date: dateStr,
                    shiftId: shift.id,
                    userId: selected.user.id,
                    isLocked: false
                });
                assignedToday.add(selected.user.id);
                totalScore += selected.score;
                updateState(selected.user.id, dateObj, shift, true);
            } else {
                // No Strict Candidates
                if (forceMode) {
                    // Fallback Logic (Sacrifice)
                    const sacrificeCandidates = users.filter(u => !assignedToday.has(u.id)).map(u => {
                        const state = userState[u.id];
                        const settings = userSettings[u.id];
                        const req = requests.find(r => r.user_id === u.id && r.date === dateStr);

                        // Calculate Violation Severity?
                        // For now, we just want to know WHY they failed to report it
                        const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);

                        return {
                            user: u,
                            failReason: check.reason,
                            hits: state.hits,
                            priority: u.category_priority
                        };
                    });

                    // Sort for Sacrifice:
                    // 1. Highest Priority Number (Lowest Importance) -> Descending
                    // 2. Fewest Hits -> Ascending
                    sacrificeCandidates.sort((a, b) => {
                        if (a.priority !== b.priority) return b.priority - a.priority; // 10 before 1
                        return a.hits - b.hits; // 0 hits before 5 hits
                    });

                    if (sacrificeCandidates.length > 0) {
                        const victim = sacrificeCandidates[0];

                        // Apply assignment
                        assignments.push({
                            date: dateStr,
                            shiftId: shift.id,
                            userId: victim.user.id,
                            isLocked: false,
                            isHit: true,
                            hitReason: victim.failReason
                        });
                        assignedToday.add(victim.user.id);

                        // Update Hits
                        userState[victim.user.id].hits++;

                        // Record Conflict
                        conflictReport.push({
                            date: dateStr,
                            shiftId: shift.id,
                            shiftName: shift.name,
                            userId: victim.user.id,
                            username: victim.user.username,
                            reason: `Forced: ${victim.failReason}`
                        });

                        updateState(victim.user.id, dateObj, shift, true);
                        totalScore -= 5000; // Big penalty but filled

                    } else {
                        // Literally no users left (all assigned?)
                        conflictReport.push({ date: dateStr, shiftId: shift.id, shiftName: shift.name, reason: "No available users (all working)" });
                        totalScore -= 10000;
                    }

                } else {
                    // Report Failure Reasons for this slot
                    const failures = users.filter(u => !assignedToday.has(u.id)).map(u => {
                         const state = userState[u.id];
                         const settings = userSettings[u.id];
                         const req = requests.find(r => r.user_id === u.id && r.date === dateStr);
                         const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);
                         return { username: u.username, reason: check.reason };
                    });

                    conflictReport.push({
                        date: dateStr,
                        shiftId: shift.id,
                        shiftName: shift.name,
                        failures
                    });
                    totalScore -= 10000;
                }
            }
        }

        // Update state for those not working
        users.forEach(u => {
            if (!assignedToday.has(u.id)) {
                updateState(u.id, dateObj, null, false);
            }
        });
    }

    return { assignments, score: totalScore, conflictReport };
};

if (typeof window !== 'undefined') {
    window.generateSchedule = generateSchedule;
}

if (typeof module !== 'undefined') {
    module.exports = {
        generateSchedule,
        checkConstraints,
        calculateScore,
        runGreedy,
        isNightShift,
        toDateStr
    };
}

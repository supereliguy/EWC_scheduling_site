// scheduler.js - Converted to ES Module-like syntax for browser, using global 'db' object

const toDateStr = (d) => {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
};

const isNightShift = (shift) => {
    // Heuristic: If it crosses midnight (end < start) OR starts very late (e.g. > 20:00)
    // Optimized: Checks pre-calculated property first
    if (!shift) return false;
    if (shift.isNight !== undefined) return shift.isNight;
    // Safety check for missing properties (e.g. incomplete test mocks or DB errors)
    if (!shift.start_time || !shift.end_time) return false;
    const s = parseInt(shift.start_time.split(':')[0], 10);
    const e = parseInt(shift.end_time.split(':')[0], 10);
    shift.isNight = e < s || s >= 20;
    return shift.isNight;
};

const isWeekendShift = (dateObj, shift, siteConfig) => {
    if (!siteConfig) return false;
    if (!shift || !shift.start_time) return false;

    // Parse config
    const startDay = siteConfig.weekend_start_day !== undefined ? siteConfig.weekend_start_day : 5;
    const startTimeStr = siteConfig.weekend_start_time || '21:00';
    const endDay = siteConfig.weekend_end_day !== undefined ? siteConfig.weekend_end_day : 0;
    const endTimeStr = siteConfig.weekend_end_time || '16:00';

    // Parse Shift Start
    const currentDay = dateObj.getDay();
    const currentStartTimeStr = shift.start_time;

    // Convert all to minutes from start of week (Sunday 00:00)
    const toMins = (day, timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return day * 1440 + h * 60 + m;
    };

    const startMins = toMins(startDay, startTimeStr);
    const endMins = toMins(endDay, endTimeStr);
    const currentMins = toMins(currentDay, currentStartTimeStr);

    if (startMins <= endMins) {
        // Normal range
        return currentMins >= startMins && currentMins <= endMins;
    } else {
        // Wrapping range
        return currentMins >= startMins || currentMins <= endMins;
    }
};

// Reusable data fetching context
const fetchScheduleContext = ({ siteId, startDate, days }) => {
    const db = (typeof window !== 'undefined' && window.db) ? window.db : global.db;

    // Parse start date
    const [y, m, d] = startDate.split('-').map(Number);
    const startObj = new Date(y, m - 1, d);

    const endObj = new Date(startObj);
    endObj.setDate(startObj.getDate() + days - 1);

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

    // All current assignments (for validation)
    const currentAssignments = db.prepare(`
        SELECT a.*, s.name as shift_name, s.start_time, s.end_time
        FROM assignments a
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.site_id = ? AND a.date BETWEEN ? AND ?
    `).all(siteId, toDateStr(startObj), toDateStr(endObj));

    const shifts = db.prepare('SELECT * FROM shifts WHERE site_id = ?').all(siteId);

    // Fetch Site Config
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);

    // Pre-calculate isNight
    shifts.forEach(isNightShift);
    prevAssignments.forEach(isNightShift);
    lockedAssignments.forEach(isNightShift);
    currentAssignments.forEach(isNightShift);

    // Users
    const users = db.prepare(`
        SELECT u.id, u.username, u.role,
               COALESCE(cat.priority, 10) as category_priority,
               cat.name as category_name
        FROM users u
        JOIN site_users su ON u.id = su.user_id
        LEFT JOIN user_categories cat ON su.category_id = cat.id
        WHERE su.site_id = ?
    `).all(siteId);

    // Settings
    const settingsRows = db.prepare('SELECT * FROM user_settings').all();
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

        let availability = { blocked_days: [], blocked_shifts: [] };
        try { availability = JSON.parse(s.availability_rules || '{"blocked_days":[], "blocked_shifts":[]}'); } catch(e) {}

        userSettings[u.id] = {
            max_consecutive: s.max_consecutive_shifts !== undefined ? s.max_consecutive_shifts : g.max_consecutive,
            min_days_off: s.min_days_off !== undefined ? s.min_days_off : g.min_days_off,
            night_pref: s.night_preference !== undefined ? s.night_preference : g.night_pref,
            target_shifts: s.target_shifts !== undefined ? s.target_shifts : g.target_shifts,
            target_variance: s.target_shifts_variance !== undefined ? s.target_shifts_variance : g.target_variance,
            preferred_block_size: s.preferred_block_size !== undefined ? s.preferred_block_size : g.preferred_block_size,
            shift_ranking: shiftRanking,
            availability
        };
    });

    const requests = db.prepare(`
        SELECT user_id, date, type FROM requests
        WHERE site_id = ? AND date BETWEEN ? AND ?
    `).all(siteId, toDateStr(startObj), toDateStr(endObj));

    const requestsMap = requests.reduce((map, r) => {
        if (!map[r.date]) map[r.date] = {};
        if (!map[r.date][r.user_id]) map[r.date][r.user_id] = r;
        return map;
    }, {});

    return {
        startObj, endObj,
        shifts, users, userSettings, requests, requestsMap,
        prevAssignments, lockedAssignments, currentAssignments,
        site // Add site to context
    };
};

// We attach to window so it can be called by api-router
const generateSchedule = async ({ siteId, startDate, days, force, iterations, onProgress }) => {
    // Access global db wrapper
    const db = (typeof window !== 'undefined' && window.db) ? window.db : global.db;

    const ctx = fetchScheduleContext({ siteId, startDate, days });

    // 2. Algorithm: Randomized Greedy with Restarts
    const maxIterations = iterations ? parseInt(iterations) : (force ? 1 : 100);
    const MAX_TIME_MS = iterations ? (iterations * 100) : 3000;
    const MAX_STAGNANT_ITERATIONS = iterations ? Math.ceil(iterations / 2) : 20;

    let bestResult = null;
    let bestScore = -Infinity;
    let stagnantIterations = 0;
    const startTime = Date.now();

    for (let i = 0; i < maxIterations; i++) {
        // Yield to UI thread for progress updates
        if (onProgress) {
            onProgress(Math.round((i / maxIterations) * 100));
            await new Promise(r => setTimeout(r, 0));
        }

        const result = runGreedy({
            siteId, startObj: ctx.startObj, days,
            shifts: ctx.shifts,
            users: ctx.users,
            userSettings: ctx.userSettings,
            requests: ctx.requests,
            requestsMap: ctx.requestsMap,
            prevAssignments: ctx.prevAssignments,
            lockedAssignments: ctx.lockedAssignments,
            forceMode: !!force,
            site: ctx.site // Pass site
        });

        if (result.score > bestScore) {
            bestScore = result.score;
            bestResult = result;
            stagnantIterations = 0;
        } else {
            stagnantIterations++;
        }

        if (!iterations && Date.now() - startTime > MAX_TIME_MS) break;
        if (!iterations && stagnantIterations >= MAX_STAGNANT_ITERATIONS) break;
    }

    // Final progress update
    if (onProgress) onProgress(100);

    if (!bestResult) {
        throw new Error("Could not generate a schedule.");
    }

    // 3. Save
    const conflicts = bestResult.conflictReport || [];
    const isComplete = conflicts.length === 0;

    if (force || isComplete) {
        const transaction = db.transaction(() => {
            // Delete NON-LOCKED assignments for this period
            const startStr = toDateStr(ctx.startObj);
            const endStr = toDateStr(ctx.endObj);
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

    // 0.1 Availability Rules (Hard Constraint)
    const dayOfWeek = dateObj.getDay(); // 0-6
    if (settings.availability && settings.availability.blocked_days && settings.availability.blocked_days.includes(dayOfWeek)) {
         return { valid: false, reason: 'Availability (Day Blocked)' };
    }

    // Check specific shift-day blocks (New Format: "shiftId-dayIndex")
    const specificBlockKey = `${shift.id}-${dayOfWeek}`;
    if (settings.availability && settings.availability.blocked_shift_days && settings.availability.blocked_shift_days.includes(specificBlockKey)) {
         return { valid: false, reason: 'Availability (Shift Blocked on Day)' };
    }

    // Check global shift blocks (Old Format: shiftId)
    if (settings.availability && settings.availability.blocked_shifts && settings.availability.blocked_shifts.includes(shift.id)) {
         return { valid: false, reason: 'Availability (Shift Blocked)' };
    }

    // 0.2 Max Variance (Hard Constraint)
    const maxShifts = (settings.target_shifts || 0) + (settings.target_variance || 0);
    if (state.totalAssigned >= maxShifts) {
        return { valid: false, reason: `Max Shifts Exceeded (${maxShifts})` };
    }

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

const calculateScore = (u, shift, dateObj, state, settings, req, site) => {
    let score = 0;
    // 3. Preferences
    if (req && req.type === 'work') score += 1000;

    const rankIndex = settings.shift_ranking.indexOf(shift.name);
    if (rankIndex !== -1) {
            score += (settings.shift_ranking.length - rankIndex) * 50;
    }

    // 4. Targets with Priority Weighting
    const priority = u.category_priority !== undefined ? u.category_priority : 10;
    const priorityFactor = Math.max(1, 11 - priority);

    const needed = settings.target_shifts - state.totalAssigned;
    score += needed * 50 * priorityFactor;

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

    // 8. Weekend Fairness (Dynamic)
    if (isWeekendShift(dateObj, shift, site)) {
        score -= (state.weekendShifts * 500);
    }

    return score;
};

const isHardConstraint = (r) => {
    if(!r) return false;
    return r.includes('Availability') || r.includes('Max Shifts') || r.includes('Requested Off');
};

const validateSchedule = ({ siteId, startDate, days, assignments: providedAssignments }) => {
    // 1. Fetch Context
    const ctx = fetchScheduleContext({ siteId, startDate, days });
    const assignments = providedAssignments || ctx.currentAssignments;

    // Report Object
    const report = {}; // userId -> { status, issues: [] }
    ctx.users.forEach(u => report[u.id] = { status: 'ok', issues: [] });

    // Initialize User State
    const userState = {};
    ctx.users.forEach(u => {
        // Find last worked day in prevAssignments
        const myPrev = ctx.prevAssignments.filter(a => a.user_id === u.id).sort((a,b) => new Date(a.date) - new Date(b.date));

        let consecutive = 0;
        let daysOff = 0;
        let lastShift = null;
        let lastDate = null;

        if (myPrev.length > 0) {
            const last = myPrev[myPrev.length - 1];
            lastShift = last;
            lastDate = new Date(last.date);
            const gap = (ctx.startObj - lastDate) / (1000 * 60 * 60 * 24);

            if (gap <= 1) {
                daysOff = 0;
                consecutive = 1;
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
            currentBlockSize: consecutive,
            weekendShifts: 0
        };
    });

    const updateState = (uId, dateObj, shift, isWorked) => {
        const s = userState[uId];
        if (isWorked) {
            s.totalAssigned++;
            if (isWeekendShift(dateObj, shift, ctx.site)) s.weekendShifts++; // Dynamic check

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

    // Iterate Days
    for (let i = 0; i < days; i++) {
        const dateObj = new Date(ctx.startObj);
        dateObj.setDate(ctx.startObj.getDate() + i);
        const dateStr = toDateStr(dateObj);

        // Get assignments for this day
        const dailyAssigns = assignments.filter(a => a.date === dateStr);
        const workedUserIds = new Set(dailyAssigns.map(a => a.userId || a.user_id));

        // 1. Check constraints for those working
        dailyAssigns.forEach(a => {
            const uId = a.userId || a.user_id;
            const u = ctx.users.find(u => u.id === uId);
            if (!u) return;

            const shiftId = a.shiftId || a.shift_id;
            const shift = ctx.shifts.find(s => s.id === shiftId);
            if (!shift) return;

            const state = userState[uId];
            const settings = ctx.userSettings[uId];
            const req = ctx.requestsMap[dateStr] ? ctx.requestsMap[dateStr][uId] : undefined;

            // Run Check
            const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);

            if (!check.valid) {
                const type = isHardConstraint(check.reason) ? 'hard' : 'soft';
                report[uId].issues.push({
                    date: dateStr,
                    type,
                    reason: check.reason,
                    shift: shift.name
                });
                if (type === 'hard') report[uId].status = 'error';
                else if (report[uId].status !== 'error') report[uId].status = 'warning';
            }

            // Update State
            updateState(uId, dateObj, shift, true);
        });

        // 2. Update state for those not working
        ctx.users.forEach(u => {
            if (!workedUserIds.has(u.id)) {
                updateState(u.id, dateObj, null, false);
            }
        });
    }

    return report;
};

const runGreedy = ({
    siteId,
    startObj,
    days,
    shifts: _shifts = [],
    users: _users = [],
    userSettings: _userSettings = {},
    requests: _requests = [],
    requestsMap: _requestsMap = null,
    prevAssignments: _prevAssignments = [],
    lockedAssignments: _lockedAssignments = [],
    forceMode = false,
    site = null // Pass site
} = {}) => {
    // Ensure inputs are valid arrays/objects
    const shifts = _shifts || [];
    const users = _users || [];
    const userSettings = _userSettings || {};
    const requests = _requests || [];
    const prevAssignments = _prevAssignments || [];
    const lockedAssignments = _lockedAssignments || [];

    const requestsMap = _requestsMap || requests.reduce((map, r) => {
        if (!map[r.date]) map[r.date] = {};
        if (!map[r.date][r.user_id]) map[r.date][r.user_id] = r;
        return map;
    }, {});

    let assignments = [...lockedAssignments.map(a => ({
        date: a.date,
        shiftId: a.shift_id,
        userId: a.user_id,
        isLocked: true,
        shiftName: a.shift_name,
        shiftObj: a
    }))];

    let totalScore = 0;
    const conflictReport = [];

    // Initialize User State
    const userState = {};
    users.forEach(u => {
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
                consecutive = 1;
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
            currentBlockSize: consecutive,
            weekendShifts: 0
        };
    });

    const updateState = (uId, dateObj, shift, isWorked) => {
        const s = userState[uId];
        if (isWorked) {
            s.totalAssigned++;
            if (isWeekendShift(dateObj, shift, site)) s.weekendShifts++; // Dynamic check

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
            const activeDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
            if (!activeDays.includes(dateObj.getDay())) return;

            const lockedForThisShift = lockedToday.filter(a => a.shiftId === s.id);
            const needed = Math.max(0, s.required_staff - lockedForThisShift.length);
            for(let k=0; k<needed; k++) slotsToFill.push(s);
        });

        const assignedToday = new Set(lockedUserIds);
        const shuffledUsers = [...users].sort(() => Math.random() - 0.5);
        slotsToFill.sort(() => Math.random() - 0.5);

        for (const shift of slotsToFill) {
            const candidates = [];

            // 1. Strict Check
            shuffledUsers.forEach(u => {
                if (assignedToday.has(u.id)) return;
                const state = userState[u.id];
                const settings = userSettings[u.id];
                const req = requestsMap[dateStr] ? requestsMap[dateStr][u.id] : undefined;

                const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);
                if (check.valid) {
                    const score = calculateScore(u, shift, dateObj, state, settings, req, site); // Pass site
                    candidates.push({ user: u, score, reason: null });
                }
            });

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
                updateState(selected.user.id, dateObj, shift, true);
            } else {
                if (forceMode) {
                    const sacrificeCandidates = users.filter(u => !assignedToday.has(u.id)).map(u => {
                        const state = userState[u.id];
                        const settings = userSettings[u.id];
                        const req = requestsMap[dateStr] ? requestsMap[dateStr][u.id] : undefined;
                        const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req);
                        return {
                            user: u,
                            failReason: check.reason,
                            hits: state.hits,
                            priority: u.category_priority
                        };
                    });

                    sacrificeCandidates.sort((a, b) => {
                        const aHard = isHardConstraint(a.failReason);
                        const bHard = isHardConstraint(b.failReason);
                        if (aHard !== bHard) return aHard ? 1 : -1;
                        if (a.priority !== b.priority) return b.priority - a.priority;
                        return a.hits - b.hits;
                    });

                    if (sacrificeCandidates.length > 0) {
                        const victim = sacrificeCandidates[0];
                        assignments.push({
                            date: dateStr,
                            shiftId: shift.id,
                            userId: victim.user.id,
                            isLocked: false,
                            isHit: true,
                            hitReason: victim.failReason
                        });
                        assignedToday.add(victim.user.id);
                        userState[victim.user.id].hits++;

                        conflictReport.push({
                            date: dateStr,
                            shiftId: shift.id,
                            shiftName: shift.name,
                            userId: victim.user.id,
                            username: victim.user.username,
                            reason: `Forced: ${victim.failReason}`
                        });

                        updateState(victim.user.id, dateObj, shift, true);
                        totalScore -= 5000;

                    } else {
                        conflictReport.push({ date: dateStr, shiftId: shift.id, shiftName: shift.name, reason: "No available users (all working)" });
                        totalScore -= 10000;
                    }
                } else {
                    const failures = users.filter(u => !assignedToday.has(u.id)).map(u => {
                         const state = userState[u.id];
                         const settings = userSettings[u.id];
                         const req = requestsMap[dateStr] ? requestsMap[dateStr][u.id] : undefined;
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
    window.validateSchedule = validateSchedule;
    window.fetchScheduleContext = fetchScheduleContext;
    window.toDateStr = toDateStr;
    window.isWeekendShift = isWeekendShift; // Expose to window for admin.js
}

if (typeof module !== 'undefined') {
    module.exports = {
        generateSchedule,
        validateSchedule,
        fetchScheduleContext,
        checkConstraints,
        calculateScore,
        runGreedy,
        isNightShift,
        isWeekendShift, // Export
        toDateStr,
        isHardConstraint
    };
}

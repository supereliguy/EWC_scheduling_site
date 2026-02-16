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
               cat.name as category_name,
               COALESCE(cat.is_manual, 0) as is_manual,
               COALESCE(cat.fill_first, 0) as fill_first
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

    // Default weights (10 = Hard, 1-9 = Soft)
    const ruleWeights = {
        max_consecutive: parseInt(globalSettings.rule_weight_max_consecutive) || 10,
        min_days_off: parseInt(globalSettings.rule_weight_min_days_off) || 10,
        target_variance: parseInt(globalSettings.rule_weight_target_variance) || 10,
        availability: parseInt(globalSettings.rule_weight_availability) || 10,
        request_off: parseInt(globalSettings.rule_weight_request_off) || 10,
        circadian_strict: parseInt(globalSettings.rule_weight_circadian_strict) || 10, // Night -> Day gap < 1 day
        circadian_soft: parseInt(globalSettings.rule_weight_circadian_soft) || 5,       // Night -> Day gap < 3 days
        min_consecutive_nights: parseInt(globalSettings.rule_weight_min_consecutive_nights) || 5, // New
        block_size: parseInt(globalSettings.rule_weight_block_size) || 5,
        weekend_fairness: parseInt(globalSettings.rule_weight_weekend_fairness) || 5,
        request_work_specific: parseInt(globalSettings.rule_weight_request_work_specific) || 10,
        request_avoid_shift: parseInt(globalSettings.rule_weight_request_avoid_shift) || 10,
        request_work: parseInt(globalSettings.rule_weight_request_work) || 10,
        min_rest_hours: parseInt(globalSettings.rule_weight_min_rest_hours) || 10 // New weight for min rest
    };

    const g = {
        max_consecutive: parseInt(globalSettings.max_consecutive_shifts) || 5,
        min_days_off: parseInt(globalSettings.min_days_off) || 2,
        min_consecutive_nights: parseInt(globalSettings.min_consecutive_nights) || 2, // New
        night_pref: parseFloat(globalSettings.night_preference) || 1.0,
        target_shifts: parseInt(globalSettings.target_shifts) || 20,
        target_variance: parseInt(globalSettings.target_shifts_variance) || 2,
        preferred_block_size: parseInt(globalSettings.preferred_block_size) || 3,
        min_rest_hours: parseFloat(globalSettings.min_rest_hours) || 12.0 // Default 12 hours
    };

    const userSettings = {};
    users.forEach(u => {
        const s = settingsRows.find(r => r.user_id === u.id) || {};
        let shiftRanking = [];
        // New format: Array of shift IDs. Old format: Array of shift names.
        try { shiftRanking = JSON.parse(s.shift_ranking || '[]'); } catch(e) {}

        let availability = { blocked_days: [], blocked_shifts: [] };
        try { availability = JSON.parse(s.availability_rules || '{"blocked_days":[], "blocked_shifts":[]}'); } catch(e) {}

        userSettings[u.id] = {
            max_consecutive: s.max_consecutive_shifts !== undefined ? s.max_consecutive_shifts : g.max_consecutive,
            min_days_off: s.min_days_off !== undefined ? s.min_days_off : g.min_days_off,
            min_consecutive_nights: g.min_consecutive_nights, // Global only for now
            night_pref: s.night_preference !== undefined ? s.night_preference : g.night_pref,
            target_shifts: s.target_shifts !== undefined ? s.target_shifts : g.target_shifts,
            target_variance: s.target_shifts_variance !== undefined ? s.target_shifts_variance : g.target_variance,
            preferred_block_size: s.preferred_block_size !== undefined ? s.preferred_block_size : g.preferred_block_size,
            shift_ranking: shiftRanking,
            no_preference: !!s.no_preference, // New flag
            min_rest_hours: g.min_rest_hours, // Global only
            availability
        };
    });

    const requests = db.prepare(`
        SELECT user_id, date, type, shift_id FROM requests
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
        site, // Add site to context
        ruleWeights // Add weights to context
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
            site: ctx.site, // Pass site
            ruleWeights: ctx.ruleWeights // Pass weights
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

const checkConstraints = (u, shift, dateStr, dateObj, state, settings, req, ruleWeights) => {
    const w = ruleWeights || {
        max_consecutive: 10,
        min_days_off: 10,
        target_variance: 10,
        availability: 10,
        request_off: 10,
        circadian_strict: 10,
        min_rest_hours: 10
    };

    // 0. Request Off
    if (req && req.type === 'off') {
        if (req.shift_id) {
            if (req.shift_id === shift.id) {
                if (w.request_off >= 10) return { valid: false, reason: 'Requested Off' };
            }
        } else {
            if (w.request_off >= 10) return { valid: false, reason: 'Requested Off' };
        }
        // If soft, we handle penalty in score, but here it's valid
    }

    // 0.05 Request Avoid Shift
    if (req && req.type === 'avoid') {
        if (req.shift_id === shift.id) {
             if (w.request_avoid_shift >= 10) return { valid: false, reason: 'Requested Avoid Shift' };
        }
    }

    // 0.1 Availability Rules
    const dayOfWeek = dateObj.getDay(); // 0-6

    // Check Day Block
    if (settings.availability && settings.availability.blocked_days && settings.availability.blocked_days.includes(dayOfWeek)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Day Blocked)' };
    }

    // Check specific shift-day blocks (New Format: "shiftId-dayIndex")
    const specificBlockKey = `${shift.id}-${dayOfWeek}`;
    if (settings.availability && settings.availability.blocked_shift_days && settings.availability.blocked_shift_days.includes(specificBlockKey)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Shift Blocked on Day)' };
    }

    // Check global shift blocks (Old Format: shiftId)
    if (settings.availability && settings.availability.blocked_shifts && settings.availability.blocked_shifts.includes(shift.id)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Shift Blocked)' };
    }

    // 0.2 Max Variance (Target Shifts)
    const maxShifts = (settings.target_shifts || 0) + (settings.target_variance || 0);
    if (state.totalAssigned >= maxShifts) {
        if (w.target_variance >= 10) return { valid: false, reason: `Max Shifts Exceeded (${maxShifts})` };
    }

    // 1. Max Consecutive
    if (state.consecutive + 1 > settings.max_consecutive) {
        if (w.max_consecutive >= 10) return { valid: false, reason: `Max Consecutive Shifts (${settings.max_consecutive})` };
    }

    // 2. Strict Circadian (Night -> Day gap) - KEEPING for backward compat, but Min Rest Hours supersedes it mostly
    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
        if (gapDays <= 1.1) {
             if (w.circadian_strict >= 10) return { valid: false, reason: 'Inadequate Rest (Night -> Day)' };
        }
    }

    // 3. Min Consecutive Nights (Prevent breaking streak early)
    if (!isNightShift(shift)) { // Day shift
        // If we are currently in a night streak (implied by consecutiveNights > 0, meaning yesterday was Night)
        if (state.consecutiveNights > 0 && state.consecutiveNights < settings.min_consecutive_nights) {
             if (w.min_consecutive_nights >= 10) return { valid: false, reason: `Min Consecutive Nights (${state.consecutiveNights}/${settings.min_consecutive_nights})` };
        }
    }

    // 4. Min Rest Hours
    if (state.lastShift && shift.start_time && shift.end_time) {
        const minRest = settings.min_rest_hours || 12;

        // Calculate End of Last Shift
        const [lastEndH, lastEndM] = state.lastShift.end_time.split(':').map(Number);
        const [lastStartH] = state.lastShift.start_time.split(':').map(Number);
        const lastEnd = new Date(state.lastDate);
        lastEnd.setHours(lastEndH, lastEndM, 0, 0);
        // If end time < start time, it ends next day
        if (lastEndH < lastStartH) {
             lastEnd.setDate(lastEnd.getDate() + 1);
        }

        // Calculate Start of Current Shift
        const [currStartH, currStartM] = shift.start_time.split(':').map(Number);
        const currStart = new Date(dateObj);
        currStart.setHours(currStartH, currStartM, 0, 0);

        const gapMs = currStart - lastEnd;
        const gapHours = gapMs / (1000 * 60 * 60);

        if (gapHours < minRest) {
             if (w.min_rest_hours >= 10) return { valid: false, reason: `Inadequate Rest (${gapHours.toFixed(1)}h < ${minRest}h)` };
        }
    }

    return { valid: true, score: 0 };
};

const calculateScore = (u, shift, dateObj, state, settings, req, site, ruleWeights) => {
    let score = 0;
    const w = ruleWeights || {
        request_off: 10,
        availability: 10,
        target_variance: 10,
        max_consecutive: 10,
        min_days_off: 10,
        circadian_strict: 10,
        circadian_soft: 5,
        block_size: 5,
        weekend_fairness: 5,
        request_work_specific: 10,
        request_avoid_shift: 10,
        request_work: 10,
        min_rest_hours: 10
    };

    // Calculate penalty helper: (weight * -1000)
    // Scale: 1 = -1000, 10 = -10000
    const getPenalty = (weight) => (weight || 1) * -1000;

    // --- Soft Constraints Checks (failed hard checks are caught here if they were soft) ---

    // Request Off
    if (req && req.type === 'off') {
        if (req.shift_id) {
            if (req.shift_id === shift.id) {
                score += getPenalty(w.request_off);
            }
        } else {
            score += getPenalty(w.request_off);
        }
    }

    // Request Avoid Shift
    if (req && req.type === 'avoid' && req.shift_id === shift.id) {
        score += getPenalty(w.request_avoid_shift);
    }

    // Availability
    const dayOfWeek = dateObj.getDay();
    const specificBlockKey = `${shift.id}-${dayOfWeek}`;
    const blocked = (settings.availability?.blocked_days?.includes(dayOfWeek)) ||
                    (settings.availability?.blocked_shift_days?.includes(specificBlockKey)) ||
                    (settings.availability?.blocked_shifts?.includes(shift.id));
    if (blocked) {
        score += getPenalty(w.availability);
    }

    // Max Shifts
    const maxShifts = (settings.target_shifts || 0) + (settings.target_variance || 0);
    if (state.totalAssigned >= maxShifts) {
        score += getPenalty(w.target_variance);
    }

    // Max Consecutive
    if (state.consecutive + 1 > settings.max_consecutive) {
        score += getPenalty(w.max_consecutive);
    }

    // Strict Circadian
    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
        if (gapDays <= 1.1) {
             score += getPenalty(w.circadian_strict);
        }
    }

    // Min Rest Hours
    if (state.lastShift && shift.start_time && shift.end_time) {
        const minRest = settings.min_rest_hours || 12;

        const [lastEndH, lastEndM] = state.lastShift.end_time.split(':').map(Number);
        const [lastStartH] = state.lastShift.start_time.split(':').map(Number);
        const lastEnd = new Date(state.lastDate);
        lastEnd.setHours(lastEndH, lastEndM, 0, 0);
        if (lastEndH < lastStartH) lastEnd.setDate(lastEnd.getDate() + 1);

        const [currStartH, currStartM] = shift.start_time.split(':').map(Number);
        const currStart = new Date(dateObj);
        currStart.setHours(currStartH, currStartM, 0, 0);

        const gapHours = (currStart - lastEnd) / (1000 * 60 * 60);
        if (gapHours < minRest) {
            score += getPenalty(w.min_rest_hours);
        }
    }

    // Min Consecutive Nights
    if (isNightShift(shift)) {
         if (state.consecutiveNights > 0 && state.consecutiveNights < settings.min_consecutive_nights) {
             score += 5000; // Big bonus to continue the streak
         }
    } else {
         if (state.consecutiveNights > 0 && state.consecutiveNights < settings.min_consecutive_nights) {
             score += getPenalty(w.min_consecutive_nights);
         }
    }

    // --- Standard Soft Rules ---

    // 3. Requests (Work)
    if (req && req.type === 'work') {
        if (req.shift_id) {
            // Specific Shift Request
            if (req.shift_id === shift.id) {
                // High Bonus!
                score += (w.request_work_specific * 500); // 10 -> 5000 bonus
            } else {
                // Requested work but for different shift.
                // We should probably NOT reward this much, or maybe a small amount because they want to work?
                // But if I request Day and you give me Night, I might be unhappy.
                // Let's give small generic bonus only
                score += (w.request_work * 100);
            }
        } else {
            // Generic Work Request
            score += (w.request_work * 100); // 10 -> 1000 bonus (matches old hardcoded 1000)
        }
    }

    // 4. Shift Ranking (Dynamic Shift ID or fallback to Name)
    if (!settings.no_preference && settings.shift_ranking && settings.shift_ranking.length > 0) {
        // Try exact ID match first
        let rankIndex = settings.shift_ranking.indexOf(shift.id);

        // Fallback to name match for legacy settings
        if (rankIndex === -1) {
             rankIndex = settings.shift_ranking.indexOf(shift.name);
        }

        if (rankIndex !== -1) {
            // Higher rank (lower index) = Higher Score
            score += (settings.shift_ranking.length - rankIndex) * 100; // Increased weight
        }
    }

    // 5. Targets with Priority Weighting
    const priority = u.category_priority !== undefined ? u.category_priority : 10;
    const priorityFactor = Math.max(1, 11 - priority);

    const needed = settings.target_shifts - state.totalAssigned;
    // Score increases as they get closer to target, but decreases if they exceed it
    if (needed > 0) {
        score += needed * 50 * priorityFactor;
    } else {
        // Discourage going over target if possible (soft penalty)
        score -= (state.totalAssigned - settings.target_shifts) * 50;
    }

    // 6. Block Size
    if (state.currentBlockShiftId === shift.id) {
        if (state.currentBlockSize < settings.preferred_block_size) {
            score += 200; // Encourage building blocks
        } else {
            score += getPenalty(w.block_size / 2); // Penalize exceeding preferred block size slightly
        }
    }

    // 7. Soft Circadian (3 day gap)
    if (state.lastShift && isNightShift(state.lastShift) && !isNightShift(shift)) {
        const gapDays = (dateObj - state.lastDate) / (1000 * 60 * 60 * 24);
        if (gapDays <= 3) {
             score += getPenalty(w.circadian_soft);
        }
    }

    // 8. Min Days Off
    if (state.daysOff > 0 && state.daysOff < settings.min_days_off) {
            score += getPenalty(w.min_days_off); // Treat min_days_off as soft rule with configured weight
    }

    // 9. Weekend Fairness (Dynamic)
    if (isWeekendShift(dateObj, shift, site)) {
        score += (state.weekendShifts * getPenalty(w.weekend_fairness));
    }

    return score;
};

const isHardConstraint = (r, ruleWeights) => {
    // Determine if a failure reason corresponds to a hard constraint based on weights
    // This is used for conflict reporting
    const w = ruleWeights || {
        max_consecutive: 10,
        min_days_off: 10,
        target_variance: 10,
        availability: 10,
        request_off: 10,
        circadian_strict: 10,
        request_avoid_shift: 10,
        min_rest_hours: 10
    };

    if (!r) return false;
    if (r.includes('Requested Off') && w.request_off >= 10) return true;
    if (r.includes('Requested Avoid Shift') && w.request_avoid_shift >= 10) return true;
    if (r.includes('Availability') && w.availability >= 10) return true;
    if (r.includes('Max Shifts') && w.target_variance >= 10) return true;
    if (r.includes('Max Consecutive') && w.max_consecutive >= 10) return true;
    if (r.includes('Inadequate Rest') && w.circadian_strict >= 10) return true;
    if (r.includes('Inadequate Rest') && w.min_rest_hours >= 10) return true; // Catch all rest violations

    return false;
};

const validateSchedule = ({ siteId, startDate, days, assignments: providedAssignments, context }) => {
    // 1. Fetch Context
    const ctx = context || fetchScheduleContext({ siteId, startDate, days });
    const assignments = providedAssignments || ctx.currentAssignments;
    const ruleWeights = ctx.ruleWeights || {};

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
        let consecutiveNights = 0;

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

            // Calculate consecutiveNights (backwards from last shift if it was night)
            if (isNightShift(lastShift) && gap <= 1) {
                 consecutiveNights = 1;
                 for (let i = myPrev.length - 2; i >= 0; i--) {
                     const curr = new Date(myPrev[i].date);
                     const next = new Date(myPrev[i+1].date);
                     if ((next - curr) / (1000 * 60 * 60 * 24) === 1) {
                         if (isNightShift(myPrev[i])) consecutiveNights++;
                         else break;
                     } else break;
                 }
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
            weekendShifts: 0,
            consecutiveNights
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

            // Consecutive Nights Update
            if (isNightShift(shift)) {
                 if (s.lastShift && isNightShift(s.lastShift) && (dateObj - s.lastDate)/(1000*60*60*24) === 1) {
                     s.consecutiveNights++;
                 } else {
                     s.consecutiveNights = 1;
                 }
            } else {
                s.consecutiveNights = 0;
            }

            s.lastShift = shift;
            s.lastDate = dateObj;
        } else {
            s.consecutive = 0;
            s.daysOff++;
            s.currentBlockSize = 0;
            s.currentBlockShiftId = null;
            s.consecutiveNights = 0;
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

            // Run Check (Force hard constraints check here for reporting)
            // Note: validateSchedule should report ALL violations, even if they were allowed as soft constraints during generation.
            // So we use a strict weight set for validation purposes? No, we should respect the configured weights.
            // If it's configured as soft (Weight < 10), it shouldn't be an ERROR, but maybe a warning?

            // Actually, checkConstraints returns valid:true if it's soft.
            // We need to know if it *would* have failed.
            // So let's run checkConstraints with ALL weights set to 10 to detect the violation,
            // then classify it based on actual weight.
            const strictWeights = {
                max_consecutive: 10,
                min_days_off: 10,
                target_variance: 10,
                availability: 10,
                request_off: 10,
                circadian_strict: 10,
                min_rest_hours: 10,
                request_avoid_shift: 10, // Ensure avoid requests are checked
                request_work_specific: 10,
                request_work: 10,
                circadian_soft: 10,
                min_consecutive_nights: 10,
                block_size: 10,
                weekend_fairness: 10
            };
            const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req, strictWeights);

            if (!check.valid) {
                const type = isHardConstraint(check.reason, ruleWeights) ? 'hard' : 'soft';
                report[uId].issues.push({
                    date: dateStr,
                    type,
                    reason: check.reason,
                    shift: shift.name
                });
                if (type === 'hard') report[uId].status = 'error';
                else if (report[uId].status !== 'error') report[uId].status = 'warning';
            } else {
                // Soft Limit Check (Target Shifts)
                // If we are exceeding target shifts but within Max (Target + Variance), flag as warning.
                // state.totalAssigned is count BEFORE adding this shift.
                // So if Target=10, 10th shift (count 9) is OK. 11th shift (count 10) is Warning.
                const target = settings.target_shifts || 0;
                if (state.totalAssigned >= target) {
                     report[uId].issues.push({
                        date: dateStr,
                        type: 'soft',
                        reason: `Over Target Shifts (${state.totalAssigned + 1} > ${target})`,
                        shift: shift.name
                    });
                    if (report[uId].status !== 'error') report[uId].status = 'warning';
                }
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

    // 3. Final Check: Under-scheduling
    ctx.users.forEach(u => {
        const state = userState[u.id];
        const settings = ctx.userSettings[u.id];
        const target = settings.target_shifts || 0;
        const variance = settings.target_variance || 0;
        const minShifts = Math.max(0, target - variance);

        if (state.totalAssigned < minShifts) {
             report[u.id].issues.push({
                date: 'All',
                type: 'warning', // Treat as warning (soft), unless strict policy needed
                reason: `Under Target Shifts (${state.totalAssigned} < ${minShifts})`,
                shift: 'General'
            });
            if (report[u.id].status !== 'error') report[u.id].status = 'warning';
        }
    });

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
    site = null, // Pass site
    ruleWeights = null // Pass weights
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
        let consecutiveNights = 0;

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

            // Calculate consecutiveNights (backwards from last shift if it was night)
            if (isNightShift(lastShift) && gap <= 1) {
                 consecutiveNights = 1;
                 for (let i = myPrev.length - 2; i >= 0; i--) {
                     const curr = new Date(myPrev[i].date);
                     const next = new Date(myPrev[i+1].date);
                     if ((next - curr) / (1000 * 60 * 60 * 24) === 1) {
                         if (isNightShift(myPrev[i])) consecutiveNights++;
                         else break;
                     } else break;
                 }
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
            weekendShifts: 0,
            consecutiveNights
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

            // Consecutive Nights Update
            if (isNightShift(shift)) {
                 if (s.lastShift && isNightShift(s.lastShift) && (dateObj - s.lastDate)/(1000*60*60*24) === 1) {
                     s.consecutiveNights++;
                 } else {
                     s.consecutiveNights = 1;
                 }
            } else {
                s.consecutiveNights = 0;
            }

            s.lastShift = shift;
            s.lastDate = dateObj;
        } else {
            s.consecutive = 0;
            s.daysOff++;
            s.currentBlockSize = 0;
            s.currentBlockShiftId = null;
            s.consecutiveNights = 0;
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

            // 1. Strict Check (Configurable Weights)
            shuffledUsers.forEach(u => {
                if (u.is_manual) return;
                if (assignedToday.has(u.id)) return;
                const state = userState[u.id];
                const settings = userSettings[u.id];
                const req = requestsMap[dateStr] ? requestsMap[dateStr][u.id] : undefined;

                const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req, ruleWeights);
                if (check.valid) {
                    const score = calculateScore(u, shift, dateObj, state, settings, req, site, ruleWeights); // Pass site & weights
                    candidates.push({ user: u, score, reason: null });
                }
            });

            candidates.sort((a, b) => {
                const fillA = a.user.fill_first ? 1 : 0;
                const fillB = b.user.fill_first ? 1 : 0;
                if (fillA !== fillB) return fillB - fillA; // Fill First users first
                return b.score - a.score;
            });

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
                    // Manual Users should NOT be candidates for sacrifice
                    const sacrificeCandidates = users.filter(u => !assignedToday.has(u.id) && !u.is_manual).map(u => {
                        const state = userState[u.id];
                        const settings = userSettings[u.id];
                        const req = requestsMap[dateStr] ? requestsMap[dateStr][u.id] : undefined;
                        // Use strict weights (all 10) to find the reason for failure
                        const strictWeights = { max_consecutive: 10, min_days_off: 10, target_variance: 10, availability: 10, request_off: 10, circadian_strict: 10, min_rest_hours: 10, request_avoid_shift: 10 };
                        const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req, strictWeights);
                        return {
                            user: u,
                            failReason: check.reason,
                            hits: state.hits,
                            priority: u.category_priority
                        };
                    });

                    sacrificeCandidates.sort((a, b) => {
                        const aHard = isHardConstraint(a.failReason, ruleWeights);
                        const bHard = isHardConstraint(b.failReason, ruleWeights);
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
                         // Check strictly to show why they failed
                         const strictWeights = { max_consecutive: 10, min_days_off: 10, target_variance: 10, availability: 10, request_off: 10, circadian_strict: 10, min_rest_hours: 10 };
                         const check = checkConstraints(u, shift, dateStr, dateObj, state, settings, req, strictWeights);
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

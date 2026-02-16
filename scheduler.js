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

    // Fair Distribution Settings
    const enableFairDist = globalSettings.enable_fair_distribution !== undefined ? (globalSettings.enable_fair_distribution === 'true' || globalSettings.enable_fair_distribution === 1) : true;

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
        ruleWeights, // Add weights to context
        enableFairDist // Add fair distribution toggle
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

    // Fair Distribution Logic (Pre-calculation)
    let effectiveUserSettings = ctx.userSettings;
    if (ctx.enableFairDist) {
        // Calculate total slots needed
        let totalSlots = 0;
        for (let i = 0; i < days; i++) {
             const d = new Date(ctx.startObj);
             d.setDate(ctx.startObj.getDate() + i);
             const dayOfWeek = d.getDay();
             ctx.shifts.forEach(s => {
                 const activeDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
                 if (activeDays.includes(dayOfWeek)) {
                     totalSlots += s.required_staff;
                 }
             });
        }

        // Calculate total requested targets
        let totalRequested = 0;
        ctx.users.forEach(u => {
            const s = ctx.userSettings[u.id];
            totalRequested += (s.target_shifts || 0);
        });

        // If mismatch, scale targets
        if (totalRequested > 0 && totalSlots > 0 && totalRequested !== totalSlots) {
            const ratio = totalSlots / totalRequested;
            effectiveUserSettings = {};
            // Deep copy and adjust
            Object.keys(ctx.userSettings).forEach(uid => {
                 const s = ctx.userSettings[uid];
                 effectiveUserSettings[uid] = { ...s };
                 // Adjust target
                 const newTarget = Math.max(1, Math.round(s.target_shifts * ratio));
                 effectiveUserSettings[uid].target_shifts = newTarget;
            });
        }
    }

    let bestResult = null;
    let bestScore = -Infinity;
    let stagnantIterations = 0;
    const startTime = Date.now();
    const strategies = ['sequential', 'reverse', 'random', 'weekends_first', 'nights_first'];

    for (let i = 0; i < maxIterations; i++) {
        // Yield to UI thread for progress updates
        if (onProgress) {
            onProgress(Math.round((i / maxIterations) * 100));
            await new Promise(r => setTimeout(r, 0));
        }

        const currentStrategy = strategies[i % strategies.length];

        // Vary randomness to escape local optima
        // Cycle: Pure Greedy -> Low Randomness -> Medium Randomness
        let currentRandomness = 0;
        if (maxIterations > 1) {
             const cycle = i % 20;
             if (cycle < 5) currentRandomness = 0;       // 25% Pure Greedy
             else if (cycle < 15) currentRandomness = 0.25; // 50% Slight perturbation (Top 2)
             else currentRandomness = 0.5;              // 25% More exploration (Top 3)
        }

        const result = runGreedy({
            siteId, startObj: ctx.startObj, days,
            shifts: ctx.shifts,
            users: ctx.users,
            userSettings: effectiveUserSettings, // Use scaled settings
            requests: ctx.requests,
            requestsMap: ctx.requestsMap,
            prevAssignments: ctx.prevAssignments,
            lockedAssignments: ctx.lockedAssignments,
            forceMode: !!force,
            site: ctx.site, // Pass site
            ruleWeights: ctx.ruleWeights, // Pass weights
            strategy: currentStrategy,
            randomness: currentRandomness
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
        success: isComplete,
        rejectionCounts: bestResult.rejectionCounts,
        effectiveUserSettings: (ctx.enableFairDist && effectiveUserSettings) ? effectiveUserSettings : ctx.userSettings // Return effective targets
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
        // Squared scoring to aggressively target needy users
        score += Math.pow(needed, 2) * 50 * priorityFactor;
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

const buildAssignmentIndex = (assignments) => {
    const index = {};
    for (const a of assignments) {
        const uid = a.userId !== undefined ? a.userId : a.user_id;
        if (!uid) continue; // Safety
        if (!index[uid]) index[uid] = {};
        if (!index[uid][a.date]) index[uid][a.date] = [];
        index[uid][a.date].push(a);
    }
    return index;
};

const checkConstraintsBiDirectional = (u, shift, dateStr, dateObj, index, _settings, req, ruleWeights, site, totalAssigned) => {
    const settings = _settings || {};
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
    }

    // 0.05 Request Avoid Shift
    if (req && req.type === 'avoid') {
        if (req.shift_id === shift.id) {
             if (w.request_avoid_shift >= 10) return { valid: false, reason: 'Requested Avoid Shift' };
        }
    }

    // 0.1 Availability Rules
    const dayOfWeek = dateObj.getDay();
    if (settings.availability && settings.availability.blocked_days && settings.availability.blocked_days.includes(dayOfWeek)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Day Blocked)' };
    }
    const specificBlockKey = `${shift.id}-${dayOfWeek}`;
    if (settings.availability && settings.availability.blocked_shift_days && settings.availability.blocked_shift_days.includes(specificBlockKey)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Shift Blocked on Day)' };
    }
    if (settings.availability && settings.availability.blocked_shifts && settings.availability.blocked_shifts.includes(shift.id)) {
         if (w.availability >= 10) return { valid: false, reason: 'Availability (Shift Blocked)' };
    }

    // 0.2 Max Variance (Target Shifts)
    const maxShifts = (settings.target_shifts || 0) + (settings.target_variance || 0);
    if (totalAssigned >= maxShifts) {
        if (w.target_variance >= 10) return { valid: false, reason: `Max Shifts Exceeded (${maxShifts})` };
    }

    // Bi-Directional Checks
    const userHistory = index[u.id] || {};
    const oneDay = 24 * 60 * 60 * 1000;

    const getAssignsAt = (offset) => {
        const d = new Date(dateObj);
        d.setDate(d.getDate() + offset);
        const s = toDateStr(d);
        return { date: d, assigns: userHistory[s] || [] };
    };

    // 1. Max Consecutive
    let backward = 0;
    let i = 1;
    while (true) {
        const { assigns, date } = getAssignsAt(-i);
        if (assigns.length > 0) backward++;
        else break;
        i++;
    }
    let forward = 0;
    i = 1;
    while (true) {
        const { assigns } = getAssignsAt(i);
        if (assigns.length > 0) forward++;
        else break;
        i++;
    }

    if (backward + 1 + forward > settings.max_consecutive) {
        // console.log(`DEBUG: User ${u.id} Date ${dateStr} Fail MaxConsec. B=${backward} F=${forward} Max=${settings.max_consecutive}`);
        if (w.max_consecutive >= 10) return { valid: false, reason: `Max Consecutive Shifts (${settings.max_consecutive})` };
    }

    // 2. Min Rest Hours & Circadian Strict
    const prev = getAssignsAt(-1);
    if (prev.assigns.length > 0) {
        for (const p of prev.assigns) {
            const pShift = p.shiftObj || p.shift;

            if (isNightShift(pShift) && !isNightShift(shift)) {
                 if (w.circadian_strict >= 10) return { valid: false, reason: 'Inadequate Rest (Night -> Day)' };
            }

            const minRest = settings.min_rest_hours || 12;
            const [pEndH, pEndM] = pShift.end_time.split(':').map(Number);
            const [pStartH] = pShift.start_time.split(':').map(Number);
            const pEndDate = new Date(prev.date);
            pEndDate.setHours(pEndH, pEndM, 0, 0);
            if (pEndH < pStartH) pEndDate.setDate(pEndDate.getDate() + 1);

            const [cStartH, cStartM] = shift.start_time.split(':').map(Number);
            const cStartDate = new Date(dateObj);
            cStartDate.setHours(cStartH, cStartM, 0, 0);

            const gap = (cStartDate - pEndDate) / (1000 * 60 * 60);
            if (gap < minRest) {
                 if (w.min_rest_hours >= 10) return { valid: false, reason: `Inadequate Rest (${gap.toFixed(1)}h < ${minRest}h)` };
            }
        }
    }

    const next = getAssignsAt(1);
    if (next.assigns.length > 0) {
        for (const n of next.assigns) {
            const nShift = n.shiftObj || n.shift;

            if (isNightShift(shift) && !isNightShift(nShift)) {
                 if (w.circadian_strict >= 10) return { valid: false, reason: 'Inadequate Rest (Night -> Day)' };
            }

            const minRest = settings.min_rest_hours || 12;
            const [cEndH, cEndM] = shift.end_time.split(':').map(Number);
            const [cStartH] = shift.start_time.split(':').map(Number);
            const cEndDate = new Date(dateObj);
            cEndDate.setHours(cEndH, cEndM, 0, 0);
            if (cEndH < cStartH) cEndDate.setDate(cEndDate.getDate() + 1);

            const [nStartH, nStartM] = nShift.start_time.split(':').map(Number);
            const nStartDate = new Date(next.date);
            nStartDate.setHours(nStartH, nStartM, 0, 0);

            const gap = (nStartDate - cEndDate) / (1000 * 60 * 60);
            if (gap < minRest) {
                 if (w.min_rest_hours >= 10) return { valid: false, reason: `Inadequate Rest (${gap.toFixed(1)}h < ${minRest}h)` };
            }
        }
    }

    // 3. Min Days Off
    const minDaysOff = settings.min_days_off || 0; // Treat 0 or undefined as no constraint, or use default?
    // Usually default is 2, but if user didn't set it?
    // If undefined, loop condition fails.
    // Let's use 100 as safety limit for loop.

    if (minDaysOff > 0) {
        if (backward > 0) {
            let gapSize = 0;
            let k = backward + 1;
            while(k < 100) {
                const { assigns } = getAssignsAt(-k);
                if (assigns.length === 0) gapSize++;
                else break;
                k++;
                if (gapSize > minDaysOff) break;
            }
            if (gapSize > 0 && gapSize < minDaysOff) {
                 if (w.min_days_off >= 10) return { valid: false, reason: `Min Days Off Violation (Prior Gap ${gapSize})` };
            }
        }
        if (forward > 0) {
            let gapSize = 0;
            let k = forward + 1;
            while(k < 100) {
                const { assigns } = getAssignsAt(k);
                if (assigns.length === 0) gapSize++;
                else break;
                k++;
                if (gapSize > minDaysOff) break;
            }
            if (gapSize > 0 && gapSize < minDaysOff) {
                 if (w.min_days_off >= 10) return { valid: false, reason: `Min Days Off Violation (Next Gap ${gapSize})` };
            }
        }
        // Check if splitting a gap
        if (backward === 0) {
             let gapSize = 0;
             let k = 1;
             while(k < 100) {
                 const { assigns } = getAssignsAt(-k);
                 if (assigns.length === 0) gapSize++;
                 else break;
                 k++;
                 if (gapSize > minDaysOff) break;
             }
             if (gapSize > 0 && gapSize < minDaysOff) {
                 if (w.min_days_off >= 10) return { valid: false, reason: `Min Days Off Violation (Created Prior Gap ${gapSize})` };
             }
        }
        if (forward === 0) {
             let gapSize = 0;
             let k = 1;
             while(k < 100) {
                 const { assigns } = getAssignsAt(k);
                 if (assigns.length === 0) gapSize++;
                 else break;
                 k++;
                 if (gapSize > minDaysOff) break;
             }
             if (gapSize > 0 && gapSize < minDaysOff) {
                 if (w.min_days_off >= 10) return { valid: false, reason: `Min Days Off Violation (Created Next Gap ${gapSize})` };
             }
        }
    }

    return { valid: true, score: 0 };
};

const calculateScoreBiDirectional = (u, shift, dateStr, dateObj, index, settings, req, site, ruleWeights, totalAssigned) => {
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
    const getPenalty = (weight) => (weight || 1) * -1000;

    if (req && req.type === 'off') score += getPenalty(w.request_off);
    if (req && req.type === 'avoid' && req.shift_id === shift.id) score += getPenalty(w.request_avoid_shift);

    const dayOfWeek = dateObj.getDay();
    const specificBlockKey = `${shift.id}-${dayOfWeek}`;
    const blocked = (settings.availability?.blocked_days?.includes(dayOfWeek)) ||
                    (settings.availability?.blocked_shift_days?.includes(specificBlockKey)) ||
                    (settings.availability?.blocked_shifts?.includes(shift.id));
    if (blocked) score += getPenalty(w.availability);

    const maxShifts = (settings.target_shifts || 0) + (settings.target_variance || 0);
    if (totalAssigned >= maxShifts) score += getPenalty(w.target_variance);

    const userHistory = index[u.id] || {};
    const oneDay = 24 * 60 * 60 * 1000;
    const getAssignsAt = (offset) => {
        const d = new Date(dateObj);
        d.setDate(d.getDate() + offset);
        const s = toDateStr(d);
        return { date: d, assigns: userHistory[s] || [] };
    };

    let backward = 0;
    let i = 1;
    while (true) {
        if (getAssignsAt(-i).assigns.length > 0) backward++; else break;
        i++;
    }
    let forward = 0;
    i = 1;
    while (true) {
        if (getAssignsAt(i).assigns.length > 0) forward++; else break;
        i++;
    }
    if (backward + 1 + forward > settings.max_consecutive) {
        score += getPenalty(w.max_consecutive);
    }

    const prev = getAssignsAt(-1);
    if (prev.assigns.length > 0) {
        for (const p of prev.assigns) {
            const pShift = p.shiftObj || p.shift;
            if (isNightShift(pShift) && !isNightShift(shift)) {
                const gapDays = (dateObj - new Date(prev.date)) / oneDay;
                if (gapDays <= 1.1) score += getPenalty(w.circadian_strict);
                else if (gapDays <= 3) score += getPenalty(w.circadian_soft);
            }
        }
    }

    if (req && req.type === 'work') {
        if (req.shift_id) {
            if (req.shift_id === shift.id) score += (w.request_work_specific * 500);
            else score += (w.request_work * 100);
        } else {
            score += (w.request_work * 100);
        }
    }

    if (!settings.no_preference && settings.shift_ranking && settings.shift_ranking.length > 0) {
        let rankIndex = settings.shift_ranking.indexOf(shift.id);
        if (rankIndex === -1) rankIndex = settings.shift_ranking.indexOf(shift.name);
        if (rankIndex !== -1) {
            score += (settings.shift_ranking.length - rankIndex) * 100;
        }
    }

    const priority = u.category_priority !== undefined ? u.category_priority : 10;
    const priorityFactor = Math.max(1, 11 - priority);
    const needed = settings.target_shifts - totalAssigned;
    if (needed > 0) score += Math.pow(needed, 2) * 50 * priorityFactor;
    else score -= (totalAssigned - settings.target_shifts) * 50;

    let weekendShifts = 0;
    if (isWeekendShift(dateObj, shift, site)) {
         // Approximate or scan. Let's scan briefly or just penalize current.
         // Scanning all keys is slow?
         // Just punish this assignment if user hates weekends?
         // But we need accumulated count.
         // Let's assume we can scan.
         Object.keys(userHistory).forEach(dStr => {
             const assigns = userHistory[dStr];
             if (assigns.length > 0) {
                 const [y,m,day] = dStr.split('-').map(Number);
                 const dateO = new Date(y, m-1, day);
                 assigns.forEach(a => {
                      const s = a.shiftObj || a.shift;
                      if (isWeekendShift(dateO, s, site)) weekendShifts++;
                 });
             }
         });
         score += (weekendShifts * getPenalty(w.weekend_fairness));
    }

    return score;
};

const generateSlots = (shifts, startObj, days) => {
    const slots = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(startObj);
        d.setDate(startObj.getDate() + i);
        const dayOfWeek = d.getDay();
        const dateStr = toDateStr(d);

        shifts.forEach(s => {
            const activeDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
            if (!activeDays.includes(dayOfWeek)) return;

            for (let k = 0; k < s.required_staff; k++) {
                slots.push({
                    date: dateStr,
                    dateObj: new Date(d),
                    shift: s,
                    id: `${dateStr}-${s.id}-${k}`
                });
            }
        });
    }
    return slots;
};

const sortSlots = (slots, strategy) => {
    switch (strategy) {
        case 'reverse':
            return [...slots].reverse();
        case 'random':
            return [...slots].sort(() => Math.random() - 0.5);
        case 'weekends_first':
             return [...slots].sort((a, b) => {
                 const aW = (a.dateObj.getDay() === 0 || a.dateObj.getDay() === 6) ? 1 : 0;
                 const bW = (b.dateObj.getDay() === 0 || b.dateObj.getDay() === 6) ? 1 : 0;
                 return bW - aW;
             });
        case 'nights_first':
             return [...slots].sort((a, b) => {
                 const aN = isNightShift(a.shift) ? 1 : 0;
                 const bN = isNightShift(b.shift) ? 1 : 0;
                 return bN - aN;
             });
        case 'sequential':
        default:
            return slots;
    }
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
    site = null,
    ruleWeights = null,
    strategy = 'sequential',
    randomness = 0
} = {}) => {
    const shifts = _shifts || [];
    const users = _users || [];
    const userSettings = _userSettings || {};
    const requests = _requests || [];
    const prevAssignments = _prevAssignments || [];
    const lockedAssignments = _lockedAssignments || [];

    // Helper to ensure assignments have shiftObj for consistent access
    const hydrate = (list) => list.map(a => {
        if (a.shiftObj) return a;
        // If coming from DB, it has flat shift props. Use itself as shiftObj or lookup.
        // Lookup is safer to ensure we have the canonical shift object with all props.
        const s = shifts.find(s => s.id === a.shift_id);
        return { ...a, shiftObj: s || a };
    });

    // Build Index
    const assignmentsMap = buildAssignmentIndex([...hydrate(prevAssignments), ...hydrate(lockedAssignments)]);
    const assignments = [...lockedAssignments.map(a => ({
        date: a.date,
        shiftId: a.shift_id,
        userId: a.user_id,
        isLocked: true,
        shiftName: a.shift_name,
        shiftObj: a.shiftObj || shifts.find(s => s.id === a.shift_id) // Ensure shiftObj exists
    }))];

    const addToIndex = (a) => {
        if (!assignmentsMap[a.userId]) assignmentsMap[a.userId] = {};
        if (!assignmentsMap[a.userId][a.date]) assignmentsMap[a.userId][a.date] = [];
        assignmentsMap[a.userId][a.date].push(a);
    };

    let totalScore = 0;
    const conflictReport = [];
    const rejectionCounts = {};
    users.forEach(u => rejectionCounts[u.id] = {});

    const allSlots = generateSlots(shifts, startObj, days);
    const sortedSlots = sortSlots(allSlots, strategy);

    const requestsMap = _requestsMap || requests.reduce((map, r) => {
        if (!map[r.date]) map[r.date] = {};
        if (!map[r.date][r.user_id]) map[r.date][r.user_id] = r;
        return map;
    }, {});

    const userCounts = {};
    users.forEach(u => {
        userCounts[u.id] = 0;
        if (assignmentsMap[u.id]) {
            Object.values(assignmentsMap[u.id]).forEach(list => {
                list.forEach(a => {
                    const d = new Date(a.date);
                    if (d >= startObj) userCounts[u.id]++;
                });
            });
        }
    });

    for (const slot of sortedSlots) {
        const filledCount = assignments.filter(a => a.date === slot.date && a.shiftId === slot.shift.id).length;
        if (filledCount >= (slot.shift.required_staff)) continue;

        const candidates = [];
        const shuffledUsers = [...users].sort(() => Math.random() - 0.5);

        for (const u of shuffledUsers) {
            if (u.is_manual) continue;
            const userWorkingToday = (assignmentsMap[u.id]?.[slot.date] || []).length > 0;
            if (userWorkingToday) continue;

            const settings = userSettings[u.id] || {};
            const req = requestsMap[slot.date] ? requestsMap[slot.date][u.id] : undefined;
            const currentCount = userCounts[u.id];

            const check = checkConstraintsBiDirectional(u, slot.shift, slot.date, slot.dateObj, assignmentsMap, settings, req, ruleWeights, site, currentCount);

            if (check.valid) {
                const score = calculateScoreBiDirectional(u, slot.shift, slot.date, slot.dateObj, assignmentsMap, settings, req, site, ruleWeights, currentCount);
                candidates.push({ user: u, score });
            } else {
                 const reason = check.reason || 'Unknown';
                 if (!rejectionCounts[u.id][reason]) rejectionCounts[u.id][reason] = 0;
                 rejectionCounts[u.id][reason]++;
            }
        }

        candidates.sort((a, b) => {
             const fillA = a.user.fill_first ? 1 : 0;
             const fillB = b.user.fill_first ? 1 : 0;
             if (fillA !== fillB) return fillB - fillA;
             return b.score - a.score;
        });

        if (candidates.length > 0) {
            let selectedIndex = 0;
            // Probabilistic selection from top candidates
            if (randomness > 0 && candidates.length > 1) {
                // Determine pool size based on randomness (e.g. 0.5 -> ~3, 1.0 -> ~5)
                const maxPool = 1 + Math.floor(randomness * 4);
                const poolSize = Math.min(candidates.length, maxPool);

                // Respect fill_first priority
                const bestFillFirst = candidates[0].user.fill_first;

                // Identify valid pool indices
                const pool = [];
                for(let k=0; k<poolSize; k++) {
                    if (candidates[k].user.fill_first === bestFillFirst) {
                        pool.push(k);
                    } else {
                        break;
                    }
                }

                if (pool.length > 0) {
                    selectedIndex = pool[Math.floor(Math.random() * pool.length)];
                }
            }

            const selected = candidates[selectedIndex];
            const newAssign = {
                date: slot.date,
                shiftId: slot.shift.id,
                userId: selected.user.id,
                isLocked: false,
                shiftObj: slot.shift
            };
            assignments.push(newAssign);
            addToIndex(newAssign);
            userCounts[selected.user.id]++;
            totalScore += selected.score;
        } else {
            if (forceMode) {
                 const sacrificeCandidates = users.filter(u => {
                      return !((assignmentsMap[u.id]?.[slot.date] || []).length > 0) && !u.is_manual;
                 }).map(u => {
                      const settings = userSettings[u.id] || {};
                      const req = requestsMap[slot.date] ? requestsMap[slot.date][u.id] : undefined;
                      const currentCount = userCounts[u.id];
                      const check = checkConstraintsBiDirectional(u, slot.shift, slot.date, slot.dateObj, assignmentsMap, settings, req, ruleWeights, site, currentCount);
                      return { user: u, failReason: check.reason, priority: u.category_priority };
                 });

                 sacrificeCandidates.sort((a,b) => {
                      const aHard = isHardConstraint(a.failReason, ruleWeights);
                      const bHard = isHardConstraint(b.failReason, ruleWeights);
                      if (aHard !== bHard) return aHard ? 1 : -1;
                      return b.priority - a.priority;
                 });

                 const validSacrifice = sacrificeCandidates.filter(c => !isHardConstraint(c.failReason, ruleWeights));

                 if (validSacrifice.length > 0) {
                     const victim = validSacrifice[0];
                     const newAssign = {
                        date: slot.date,
                        shiftId: slot.shift.id,
                        userId: victim.user.id,
                        isLocked: false,
                        isHit: true,
                        hitReason: victim.failReason,
                        shiftObj: slot.shift
                     };
                     assignments.push(newAssign);
                     addToIndex(newAssign);
                     userCounts[victim.user.id]++;
                     totalScore -= 5000;
                     conflictReport.push({
                        date: slot.date,
                        shiftId: slot.shift.id,
                        shiftName: slot.shift.name,
                        userId: victim.user.id,
                        username: victim.user.username,
                        reason: `Forced: ${victim.failReason}`
                     });
                 } else {
                     conflictReport.push({
                        date: slot.date,
                        shiftId: slot.shift.id,
                        shiftName: slot.shift.name,
                        failures: sacrificeCandidates.map(c => ({ username: c.user.username, reason: c.failReason, userId: c.user.id }))
                     });
                     totalScore -= 10000;
                 }
            } else {
                 const failures = users.map(u => {
                     const isWorking = (assignmentsMap[u.id]?.[slot.date] || []).length > 0;
                     if (isWorking) return null;

                     const settings = userSettings[u.id] || {};
                     const req = requestsMap[slot.date] ? requestsMap[slot.date][u.id] : undefined;
                     const strictWeights = { max_consecutive: 10, min_days_off: 10, target_variance: 10, availability: 10, request_off: 10, circadian_strict: 10, min_rest_hours: 10, request_avoid_shift: 10 };
                     const currentCount = userCounts[u.id];
                     const check = checkConstraintsBiDirectional(u, slot.shift, slot.date, slot.dateObj, assignmentsMap, settings, req, strictWeights, site, currentCount);
                     return { username: u.username, reason: check.reason, userId: u.id };
                 }).filter(f => f !== null);

                 // Sort by username to keep UI stable
                 failures.sort((a,b) => a.username.localeCompare(b.username));

                 conflictReport.push({
                    date: slot.date,
                    shiftId: slot.shift.id,
                    shiftName: slot.shift.name,
                    failures
                 });
                 totalScore -= 10000;
            }
        }
    }

    return { assignments, score: totalScore, conflictReport, rejectionCounts };
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
        isHardConstraint,
        checkConstraintsBiDirectional,
        calculateScoreBiDirectional,
        buildAssignmentIndex,
        generateSlots,
        sortSlots
    };
}

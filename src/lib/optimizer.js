class Optimizer {
    /**
     * @param {Object} params
     * @param {Array} params.shifts - List of shift objects {id, name, start_time, end_time, required_staff}
     * @param {Array} params.users - List of user objects {id, username, role}
     * @param {Object} params.userSettings - Map userId -> { max_consecutive, min_days_off, night_pref }
     * @param {Array} params.requests - List of {user_id, date, type}
     * @param {Object} params.initialState - Map userId -> { consecutiveShifts, daysOff, totalAssigned }
     * @param {number} params.year
     * @param {number} params.month
     */
    constructor({ shifts, users, userSettings, requests, initialState, year, month }) {
        this.shifts = shifts;
        this.users = users;
        this.userSettings = userSettings;
        this.requests = requests;
        this.initialState = initialState;
        this.year = year;
        this.month = month; // 1-12

        this.startDate = new Date(year, month - 1, 1);
        this.endDate = new Date(year, month, 0);
        this.daysInMonth = this.endDate.getDate();

        // Constants / Weights
        this.WEIGHTS = {
            REQUEST_WORK: 1000,
            REQUEST_OFF_VIOLATION: -10000,
            MAX_CONSECUTIVE_VIOLATION: -5000,
            MAX_CONSECUTIVE_WARNING: -50,
            MIN_DAYS_OFF_VIOLATION: -2000,
            NIGHT_PREF_MULTIPLIER: 100,
            FAIRNESS_PENALTY: 10
        };
    }

    solve(iterations = 100) {
        let bestSchedule = null;
        let bestScore = -Infinity;

        for (let i = 0; i < iterations; i++) {
            const result = this.runGreedy();
            if (result.score > bestScore) {
                bestScore = result.score;
                bestSchedule = result.assignments;
            }
        }

        if (!bestSchedule) {
            throw new Error("Could not generate a valid schedule.");
        }

        return { assignments: bestSchedule, score: bestScore };
    }

    runGreedy() {
        let assignments = [];
        let totalScore = 0;

        // Clone state
        const state = {};
        for (const u of this.users) {
            const init = this.initialState[u.id] || { consecutiveShifts: 0, daysOff: 1, totalAssigned: 0 };
            state[u.id] = { ...init };
        }

        for (let day = 1; day <= this.daysInMonth; day++) {
            const dateStr = `${this.year}-${this.month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

            // Randomize user order for variety
            const shuffledUsers = [...this.users].sort(() => Math.random() - 0.5);
            const dayAssignments = new Set(); // userIds assigned today

            for (const shift of this.shifts) {
                const required = shift.required_staff || 1;
                const isNight = this.isNightShift(shift);

                // Filter valid candidates and score them
                const candidates = shuffledUsers
                    .filter(u => !dayAssignments.has(u.id))
                    .map(u => {
                        const score = this.calculateScore(u, dateStr, isNight, state[u.id]);
                        if (score === -Infinity) return null; // Hard constraint
                        return { user: u, score };
                    })
                    .filter(c => c !== null);

                // Sort by score
                candidates.sort((a, b) => b.score - a.score);

                // Pick top candidates
                const selected = candidates.slice(0, required);

                // If we can't fill the shift, that's a problem, but for now we just fill what we can
                // or we could penalize the total score heavily.
                if (selected.length < required) {
                    totalScore -= 10000; // Penalty for unfilled shift
                }

                for (const { user, score } of selected) {
                    assignments.push({ date: dateStr, shiftId: shift.id, userId: user.id });
                    dayAssignments.add(user.id);
                    totalScore += score;
                }
            }

            // Update state for next day
            this.users.forEach(u => {
                if (dayAssignments.has(u.id)) {
                    state[u.id].consecutiveShifts++;
                    state[u.id].daysOff = 0;
                    state[u.id].totalAssigned++;
                } else {
                    state[u.id].consecutiveShifts = 0;
                    state[u.id].daysOff++;
                }
            });
        }

        return { assignments, score: totalScore };
    }

    calculateScore(user, dateStr, isNight, currentState) {
        const settings = this.userSettings[user.id] || { max_consecutive: 5, min_days_off: 2, night_pref: 1.0 };
        const req = this.requests.find(r => r.user_id === user.id && r.date === dateStr);
        let score = 0;

        // 1. Hard Constraints
        if (req && req.type === 'off') {
            return -Infinity;
        }

        // 2. Preferences (Requests)
        if (req && req.type === 'work') {
            score += this.WEIGHTS.REQUEST_WORK;
        }

        // 3. Night Preference
        // Pref > 1 (Likes), Pref < 1 (Dislikes)
        // If Night: Bonus if Pref > 1, Penalty if Pref < 1
        // If Day: Penalty if Pref > 1, Bonus if Pref < 1
        // Formula: (isNight ? 1 : -1) * (pref - 1)
        const prefFactor = (settings.night_pref !== undefined ? settings.night_pref : 1.0);
        const direction = isNight ? 1 : -1;
        score += direction * (prefFactor - 1) * this.WEIGHTS.NIGHT_PREF_MULTIPLIER;

        // 4. Max Consecutive Shifts
        // If I work today, consecutive becomes current + 1
        const nextConsecutive = currentState.consecutiveShifts + 1;
        if (nextConsecutive > settings.max_consecutive) {
            score += this.WEIGHTS.MAX_CONSECUTIVE_VIOLATION;
        } else if (nextConsecutive === settings.max_consecutive) {
            // Soft penalty to avoid hitting the limit if possible
            score += this.WEIGHTS.MAX_CONSECUTIVE_WARNING;
        }

        // 5. Min Days Off (Rest between blocks)
        // Check if we are breaking a rest period
        // If I work today (daysOff becomes 0).
        // Only bad if I was resting (daysOff > 0) but not for long enough (daysOff < min).
        if (currentState.daysOff > 0 && currentState.daysOff < settings.min_days_off) {
            score += this.WEIGHTS.MIN_DAYS_OFF_VIOLATION;
        }

        // 6. Fairness (Equalization)
        // Penalize users who already have many shifts
        score -= currentState.totalAssigned * this.WEIGHTS.FAIRNESS_PENALTY;

        return score;
    }

    isNightShift(shift) {
        // Simple heuristic: if end time < start time (crosses midnight) or starts late (e.g. > 18:00)
        // The previous code used end < start.
        if (shift.end_time < shift.start_time) return true;

        // Also consider shifts starting after 6 PM as night/evening
        const startHour = parseInt(shift.start_time.split(':')[0], 10);
        if (startHour >= 18) return true;

        return false;
    }
}

module.exports = Optimizer;

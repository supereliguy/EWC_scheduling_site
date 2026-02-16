class CalendarWidget {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            readOnly: false,
            onPaint: null, // callback(date, type, shiftId)
            ...options
        };
        this.date = new Date();
        this.requests = []; // { date: 'YYYY-MM-DD', type: 'work'|'off'|'avoid', shiftId, shiftName }
        this.assignments = []; // { date: 'YYYY-MM-DD', shiftName: '...' }
        this.paintMode = null; // { type: '...', shiftId: ..., shiftName: ... }
        this.shifts = []; // New: store available shifts
        this.isPainting = false;
        this.dragStart = null;
        this.dragEnd = null;

        this.init();
    }

    init() {
        this.container.classList.add('calendar-grid');
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.container.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    setMonth(year, month) {
        this.date = new Date(year, month - 1, 1);
        this.render();
    }

    setData(requests, assignments = []) {
        this.requests = requests || [];
        this.assignments = assignments || [];
        this.render();
    }

    setShifts(shifts) {
        this.shifts = shifts || [];
        this.render();
    }

    setPaintMode(type, shiftId = null, shiftName = null) {
        this.paintMode = { type, shiftId, shiftName };
    }

    render() {
        this.container.innerHTML = '';
        const year = this.date.getFullYear();
        const month = this.date.getMonth();

        // Weekday Headers
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekdays.forEach(day => {
            const el = document.createElement('div');
            el.textContent = day;
            el.style.fontWeight = 'bold';
            el.style.textAlign = 'center';
            this.container.appendChild(el);
        });

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        // Padding for first week
        for (let i = 0; i < firstDay.getDay(); i++) {
            const el = document.createElement('div');
            el.classList.add('calendar-day', 'empty');
            this.container.appendChild(el);
        }

        // Days
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const dayEl = document.createElement('div');
            dayEl.classList.add('calendar-day');

            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            dayEl.dataset.date = dateStr;

            // Check if whole day is off
            const dayOffReq = this.requests.find(r => r.date === dateStr && r.type === 'off' && !r.shiftId);
            if (dayOffReq) {
                dayEl.classList.add('day-off');
            }

            // Header (Day Number)
            const header = document.createElement('div');
            header.className = 'day-header';
            header.textContent = i;
            header.title = "Click to toggle Day Off";
            dayEl.appendChild(header);

            // Shift Pills Container
            const list = document.createElement('div');
            list.className = 'shift-list';
            list.style.display = 'flex';
            list.style.flexWrap = 'wrap';
            list.style.gap = '2px';
            list.style.marginTop = '4px';

            this.shifts.forEach(s => {
                const pill = document.createElement('div');
                pill.className = 'shift-pill';
                // Abbreviate name if too long? No, CSS can handle overflow or just wrapping.
                pill.textContent = s.name;
                pill.dataset.shiftId = s.id;
                pill.dataset.shiftName = s.name;
                pill.title = s.name;

                // Check status
                const req = this.requests.find(r => r.date === dateStr && (r.shiftId === s.id || r.shiftId == s.id)); // Handle string/int mismatch
                if (req) {
                    if (req.type === 'work') pill.classList.add('work');
                    else if (req.type === 'avoid') pill.classList.add('avoid');
                    else if (req.type === 'off') pill.classList.add('off');
                }

                list.appendChild(pill);
            });
            dayEl.appendChild(list);

            this.container.appendChild(dayEl);
        }

        // Padding for last week
        const used = firstDay.getDay() + lastDay.getDate();
        const remaining = 7 - (used % 7);
        if (remaining < 7) {
            for(let i=0; i<remaining; i++) {
                 const el = document.createElement('div');
                 el.classList.add('calendar-day', 'empty');
                 this.container.appendChild(el);
            }
        }
    }

    handleMouseDown(e) {
        if (this.options.readOnly) return;
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl || dayEl.classList.contains('empty')) return;

        const date = dayEl.dataset.date;
        const target = e.target;

        // Check for Shift Pill Click (Prioritize specific shift toggles)
        const pill = target.closest('.shift-pill');
        if (pill) {
            const shiftId = parseInt(pill.dataset.shiftId);
            const shiftName = pill.dataset.shiftName;
            this.toggleShiftRequest(date, shiftId, shiftName);
            this.render();
            if (this.options.onPaint) this.options.onPaint();
            return;
        }

        // Otherwise, Day Click/Drag
        // Only enable drag if in "Off" mode (or generic mode without specific shift)
        // If we have a specific shift selected, dragging day-to-day is ambiguous
        // (Do we add that shift to all days? Maybe, but user specifically asked for "highlight multiple days for off")
        if (this.paintMode && (this.paintMode.type === 'off' || this.paintMode.type === 'clear') && !this.paintMode.shiftId) {
            this.dragStart = date;
            this.dragEnd = date;
            this.updateDragHighlights();
            e.preventDefault(); // Prevent text selection
        } else {
            // Fallback for other modes: just toggle single day
            // But wait, we moved logic to mouseup for drag support.
            // If we are not in drag mode, we should execute immediately?
            // Or just treat as 1-day drag?
            // Let's treat as 1-day drag for consistency.
            this.dragStart = date;
            this.dragEnd = date;
            this.updateDragHighlights();
        }
    }

    handleMouseMove(e) {
        if (!this.dragStart) return;

        const dayEl = e.target.closest('.calendar-day');
        if (dayEl && !dayEl.classList.contains('empty')) {
             const date = dayEl.dataset.date;
             if (this.dragEnd !== date) {
                 this.dragEnd = date;
                 this.updateDragHighlights();
             }
        }
    }

    handleMouseUp(e) {
        if (!this.dragStart) return;

        // Apply action to range
        const dates = this.getDatesInRange(this.dragStart, this.dragEnd);
        const mode = this.paintMode ? this.paintMode.type : 'off';
        const shiftId = this.paintMode ? this.paintMode.shiftId : null;
        const shiftName = this.paintMode ? this.paintMode.shiftName : null;

        let changed = false;

        // Determine Action:
        // If single click (dates.length === 1), we toggle.
        // If drag (dates.length > 1), we set to active mode (Add).

        const isBulk = dates.length > 1;

        dates.forEach(date => {
            if (shiftId) {
                // Shift Mode
                if (isBulk) {
                    // Set (Add)
                    this.setShiftRequest(date, shiftId, shiftName, mode);
                    changed = true;
                } else {
                    // Toggle
                    this.toggleShiftRequest(date, shiftId, shiftName);
                    // toggleShiftRequest handles its own render/callback, but we might double render here.
                    // Actually toggleShiftRequest modifies this.requests.
                    // We should suppressing render in loop and render once.
                    // Refactor toggleShiftRequest to return boolean?
                    // For now, let's just let it run.
                    changed = true;
                }
            } else {
                // Day Mode (Off/Clear)
                if (isBulk) {
                     // Force Set
                     if (mode === 'clear') {
                         this.removeDayRequests(date);
                         changed = true;
                     } else {
                         // Set to Off
                         this.setDayOff(date, true);
                         changed = true;
                     }
                } else {
                    // Toggle
                    if (mode === 'clear') {
                         this.removeDayRequests(date); // Clear is clear
                    } else {
                         this.toggleDayOff(date);
                    }
                    changed = true;
                }
            }
        });

        this.dragStart = null;
        this.dragEnd = null;

        // Cleanup visuals
        this.container.querySelectorAll('.drag-highlight').forEach(el => el.classList.remove('drag-highlight'));

        if (changed && isBulk) {
            // If isBulk, we didn't call toggle methods that render.
            // If single, toggle methods called render.
            // But wait, I called toggleShiftRequest/toggleDayOff which DO call render.
            // So render is called N times. Not ideal but functional.
            // Optimization: split logic.
        }

        // Re-render to be safe and clean
        this.render();
        if (this.options.onPaint) this.options.onPaint();
    }

    getDatesInRange(startStr, endStr) {
        const start = new Date(startStr);
        const end = new Date(endStr);
        const dates = [];

        // Handle reverse drag
        const low = start < end ? start : end;
        const high = start < end ? end : start;

        const current = new Date(low);
        while (current <= high) {
             dates.push(current.toISOString().split('T')[0]);
             current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    updateDragHighlights() {
        if (!this.dragStart || !this.dragEnd) return;
        const dates = new Set(this.getDatesInRange(this.dragStart, this.dragEnd));

        this.container.querySelectorAll('.calendar-day').forEach(el => {
            if (dates.has(el.dataset.date)) {
                el.classList.add('drag-highlight');
            } else {
                el.classList.remove('drag-highlight');
            }
        });
    }

    setDayOff(date, forceOn) {
         // Force Day Off
         // Remove existing requests for this day
         this.removeDayRequests(date);
         this.requests.push({ date, type: 'off', shiftId: null, shiftName: null });
    }

    removeDayRequests(date) {
         let i = this.requests.length;
         while (i--) {
             if (this.requests[i].date === date) {
                 this.requests.splice(i, 1);
             }
         }
    }

    // Updated toggleShiftRequest to separate logic from render if needed, but keeping it simple for now.
    // We will just call it.

    toggleDayOff(date) {
        // Find existing Day Off request (type='off', shiftId=null)
        const idx = this.requests.findIndex(r => r.date === date && r.type === 'off' && !r.shiftId);

        if (idx > -1) {
            this.requests.splice(idx, 1);
        } else {
            this.removeDayRequests(date);
            this.requests.push({ date, type: 'off', shiftId: null, shiftName: null });
        }
        // render handled by caller if bulk
    }

    toggleShiftRequest(date, shiftId, shiftName) {
        if (!this.paintMode) return;
        const mode = this.paintMode.type;

        let targetType = null;
        if (mode === 'work') targetType = 'work';
        else if (mode === 'avoid') targetType = 'avoid';
        else if (mode === 'off') targetType = 'off';
        else if (mode === 'clear') targetType = null;

        const idx = this.requests.findIndex(r => r.date === date && (r.shiftId == shiftId));

        if (idx > -1) {
            const existing = this.requests[idx];
            if (targetType === null || existing.type === targetType) {
                this.requests.splice(idx, 1);
            } else {
                existing.type = targetType;
            }
        } else {
            if (targetType !== null) {
                this.requests.push({ date, type: targetType, shiftId, shiftName });
                // Remove day off if specific shift added
                const dayOffIdx = this.requests.findIndex(r => r.date === date && r.type === 'off' && !r.shiftId);
                if (dayOffIdx > -1) this.requests.splice(dayOffIdx, 1);
            }
        }
        // render handled by caller
    }

    setShiftRequest(date, shiftId, shiftName, mode) {
        // Helper for bulk set
        let targetType = null;
        if (mode === 'work') targetType = 'work';
        else if (mode === 'avoid') targetType = 'avoid';
        else if (mode === 'off') targetType = 'off';

        if (!targetType) return; // clear not handled here, handled by remove

        // Remove existing for this shift
        const idx = this.requests.findIndex(r => r.date === date && (r.shiftId == shiftId));
        if (idx > -1) this.requests.splice(idx, 1);

        this.requests.push({ date, type: targetType, shiftId, shiftName });

        // Remove day off
        const dayOffIdx = this.requests.findIndex(r => r.date === date && r.type === 'off' && !r.shiftId);
        if (dayOffIdx > -1) this.requests.splice(dayOffIdx, 1);
    }
}

// Attach to window
if (typeof window !== 'undefined') {
    window.CalendarWidget = CalendarWidget;
}

// Export for Node/Jest
if (typeof module !== 'undefined') {
    module.exports = { CalendarWidget };
}

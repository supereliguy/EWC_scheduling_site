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

        this.init();
    }

    init() {
        this.container.classList.add('calendar-grid');
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        // Removed drag-painting for now as it's complex with individual shift toggles
        // document.addEventListener('mouseup', () => { this.isPainting = false; });
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
                    else if (req.type === 'off') pill.classList.add('avoid'); // Treat specific off as avoid/block
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

        // 1. Check if clicked Day Header (Toggle Whole Day Off)
        if (target.closest('.day-header') || target === dayEl) {
            this.toggleDayOff(date);
            return;
        }

        // 2. Check if clicked Shift Pill
        const pill = target.closest('.shift-pill');
        if (pill) {
            const shiftId = parseInt(pill.dataset.shiftId);
            const shiftName = pill.dataset.shiftName;
            this.toggleShiftRequest(date, shiftId, shiftName);
            return;
        }
    }

    toggleDayOff(date) {
        // Find existing Day Off request (type='off', shiftId=null)
        const idx = this.requests.findIndex(r => r.date === date && r.type === 'off' && !r.shiftId);

        if (idx > -1) {
            // Remove it
            this.requests.splice(idx, 1);
        } else {
            // Add it. Also, maybe clear other requests for this day to keep it clean?
            // Usually Day Off implies no specific shift requests needed.
            // Let's remove any other requests for this date first.
            let i = this.requests.length;
            while (i--) {
                if (this.requests[i].date === date) {
                    this.requests.splice(i, 1);
                }
            }
            this.requests.push({ date, type: 'off', shiftId: null, shiftName: null });
        }
        this.render();
        if (this.options.onPaint) this.options.onPaint();
    }

    toggleShiftRequest(date, shiftId, shiftName) {
        if (!this.paintMode) return;
        const mode = this.paintMode.type; // 'work', 'avoid', 'off', 'clear'

        // Determine intended type for this shift
        let targetType = null;
        if (mode === 'work') targetType = 'work';
        else if (mode === 'avoid') targetType = 'avoid';
        else if (mode === 'off') targetType = 'avoid'; // Off tool on shift = Avoid
        else if (mode === 'clear') targetType = null;

        // Find existing request for this shift
        const idx = this.requests.findIndex(r => r.date === date && (r.shiftId == shiftId)); // Loose eq for safety

        if (idx > -1) {
            const existing = this.requests[idx];

            if (targetType === null) {
                // Clear tool -> Remove
                this.requests.splice(idx, 1);
            } else if (existing.type === targetType) {
                // Clicking same type -> Toggle Off (Remove)
                this.requests.splice(idx, 1);
            } else {
                // Different type -> Update
                existing.type = targetType;
            }
        } else {
            // No existing request
            if (targetType !== null) {
                // Add new request
                this.requests.push({ date, type: targetType, shiftId, shiftName });

                // If there was a Whole Day Off, remove it because user is adding specific constraints?
                // Or keep it? If Day Off is set, specific constraints might be ignored by backend anyway.
                // But for UI clarity, if I say "I want to work Shift A", I probably don't want "Day Off" anymore.
                const dayOffIdx = this.requests.findIndex(r => r.date === date && r.type === 'off' && !r.shiftId);
                if (dayOffIdx > -1) this.requests.splice(dayOffIdx, 1);
            }
        }

        this.render();
        if (this.options.onPaint) this.options.onPaint();
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

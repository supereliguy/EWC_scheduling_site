export class CalendarWidget {
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
        this.isPainting = false;

        this.init();
    }

    init() {
        this.container.classList.add('calendar-grid');
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.container.addEventListener('mouseover', (e) => this.handleMouseOver(e));
        document.addEventListener('mouseup', () => { this.isPainting = false; });
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
            dayEl.textContent = i;
            dayEl.classList.add('calendar-day');

            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
            dayEl.dataset.date = dateStr;

            // Requests
            const req = this.requests.find(r => r.date === dateStr);
            if (req) {
                dayEl.classList.add(req.type);
                if (req.shiftName) {
                    const badge = document.createElement('div');
                    badge.className = 'req-badge';
                    badge.style.fontSize = '0.7rem';
                    badge.style.fontWeight = 'bold';
                    badge.textContent = req.shiftName;
                    dayEl.appendChild(badge);
                }
            }

            // Assignments
            const assign = this.assignments.find(a => a.date === dateStr);
            if (assign) {
                dayEl.classList.add('assigned'); // visual indicator
                // Maybe a small dot or text
                const badge = document.createElement('div');
                badge.className = 'assign-badge';
                badge.style.fontSize = '0.75rem';
                badge.style.color = '#0d6efd';
                badge.textContent = assign.shiftName;
                dayEl.appendChild(badge);
            }

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
        if (dayEl) {
            this.isPainting = true;
            this.applyPaint(dayEl);
        }
    }

    handleMouseOver(e) {
        if (this.options.readOnly || !this.isPainting) return;
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl) {
            this.applyPaint(dayEl);
        }
    }

    applyPaint(dayEl) {
        if (!this.paintMode) return;

        const { type, shiftId, shiftName } = this.paintMode;

        dayEl.classList.remove('work', 'off', 'avoid');
        // Remove existing request badge
        const oldBadge = dayEl.querySelector('.req-badge');
        if (oldBadge) oldBadge.remove();

        if (type !== 'clear') {
            dayEl.classList.add(type);
            if (shiftName) {
                const badge = document.createElement('div');
                badge.className = 'req-badge';
                badge.style.fontSize = '0.7rem';
                badge.style.fontWeight = 'bold';
                badge.textContent = shiftName;
                dayEl.appendChild(badge);
            }
        }

        const date = dayEl.dataset.date;
        const reqType = type === 'clear' ? 'none' : type;

        // Update internal state
        const idx = this.requests.findIndex(r => r.date === date);
        if (idx > -1) {
            if (reqType === 'none') {
                this.requests.splice(idx, 1);
            } else {
                this.requests[idx] = { date, type: reqType, shiftId, shiftName };
            }
        } else if (reqType !== 'none') {
            this.requests.push({ date, type: reqType, shiftId, shiftName });
        }

        if (this.options.onPaint) {
            this.options.onPaint(date, reqType, shiftId);
        }
    }
}

// Attach to window
window.CalendarWidget = CalendarWidget;

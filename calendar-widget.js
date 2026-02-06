export class CalendarWidget {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            readOnly: false,
            onPaint: null, // callback(date, type)
            ...options
        };
        this.date = new Date();
        this.requests = []; // { date: 'YYYY-MM-DD', type: 'work'|'off' }
        this.assignments = []; // { date: 'YYYY-MM-DD', shiftName: '...' }
        this.paintMode = null;
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

    setPaintMode(mode) {
        this.paintMode = mode;
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
            }

            // Assignments
            const assign = this.assignments.find(a => a.date === dateStr);
            if (assign) {
                dayEl.classList.add('assigned'); // visual indicator
                // Maybe a small dot or text
                const badge = document.createElement('div');
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

        dayEl.classList.remove('work', 'off');
        if (this.paintMode !== 'clear') {
            dayEl.classList.add(this.paintMode);
        }

        const date = dayEl.dataset.date;
        const type = this.paintMode === 'clear' ? 'none' : this.paintMode;

        // Update internal state
        const idx = this.requests.findIndex(r => r.date === date);
        if (idx > -1) {
            if (type === 'none') this.requests.splice(idx, 1);
            else this.requests[idx].type = type;
        } else if (type !== 'none') {
            this.requests.push({ date, type });
        }

        if (this.options.onPaint) {
            this.options.onPaint(date, type);
        }
    }
}

// Attach to window
window.CalendarWidget = CalendarWidget;

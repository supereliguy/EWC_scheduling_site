/** @jest-environment jsdom */
const { CalendarWidget } = require('../calendar-widget.js');

describe('CalendarWidget Interaction', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'calendar';
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('renders day header and shift pills', () => {
        const widget = new CalendarWidget('calendar');
        widget.setShifts([
            { id: 1, name: 'Day' },
            { id: 2, name: 'Night' }
        ]);

        // Find a day (e.g. 1st)
        const day = container.querySelector('.calendar-day:not(.empty)');
        expect(day).not.toBeNull();

        // Header
        const header = day.querySelector('.day-header');
        expect(header).not.toBeNull();

        // Pills
        const pills = day.querySelectorAll('.shift-pill');
        expect(pills.length).toBe(2);
        expect(pills[0].textContent).toBe('Day');
        expect(pills[1].textContent).toBe('Night');
    });

    test('toggles work request on pill click', () => {
        const widget = new CalendarWidget('calendar');
        const shifts = [{ id: 1, name: 'Day' }];
        widget.setShifts(shifts);
        widget.setPaintMode('work');

        const pill = container.querySelector('.shift-pill[data-shift-id="1"]');
        pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(widget.requests.length).toBe(1);
        expect(widget.requests[0].type).toBe('work');
        expect(widget.requests[0].shiftId).toBe(1);
        expect(widget.requests[0].shiftName).toBe('Day');

        // Check pill class
        const updatedPill = container.querySelector('.shift-pill[data-shift-id="1"]');
        expect(updatedPill.classList.contains('work')).toBe(true);
    });

    test('toggles avoid request on pill click', () => {
        const widget = new CalendarWidget('calendar');
        const shifts = [{ id: 1, name: 'Day' }];
        widget.setShifts(shifts);
        widget.setPaintMode('avoid');

        const pill = container.querySelector('.shift-pill[data-shift-id="1"]');
        pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(widget.requests.length).toBe(1);
        expect(widget.requests[0].type).toBe('avoid');

        // Check pill class
        const updatedPill = container.querySelector('.shift-pill[data-shift-id="1"]');
        expect(updatedPill.classList.contains('avoid')).toBe(true);
    });

    test('toggles whole day off on header click', () => {
        const widget = new CalendarWidget('calendar');
        widget.setShifts([]);
        widget.setPaintMode('off'); // Ensure correct mode

        const day = container.querySelector('.calendar-day:not(.empty)');
        const header = day.querySelector('.day-header');

        // Simulate Drag-Click (MouseDown + MouseUp)
        header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        expect(widget.requests.length).toBe(1);
        expect(widget.requests[0].type).toBe('off');
        expect(widget.requests[0].shiftId).toBeNull();

        // Check day class
        const updatedDay = container.querySelector('.calendar-day:not(.empty)');
        expect(updatedDay.classList.contains('day-off')).toBe(true);
    });

    test('removes work request on second click', () => {
        const widget = new CalendarWidget('calendar');
        const shifts = [{ id: 1, name: 'Day' }];
        widget.setShifts(shifts);
        widget.setPaintMode('work');

        const pill = container.querySelector('.shift-pill[data-shift-id="1"]');

        // Click 1: Add
        pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(widget.requests.length).toBe(1);

        // Click 2: Remove
        const pill2 = container.querySelector('.shift-pill[data-shift-id="1"]');
        pill2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(widget.requests.length).toBe(0);
        const pill3 = container.querySelector('.shift-pill[data-shift-id="1"]');
        expect(pill3.classList.contains('work')).toBe(false);
    });
});

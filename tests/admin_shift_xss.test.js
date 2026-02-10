/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin Shift XSS Vulnerability Check', () => {
    let dom;

    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = '<table id="shifts-table"><tbody></tbody></table>';
        global.shifts = [];
        global.apiClient = { get: jest.fn() };
        // Mock window functions referenced in renderShifts
        window.deleteShift = jest.fn();
        // Mock escapeHTML globally as it is used in renderShifts
        global.escapeHTML = (str) => {
            if (!str) return '';
            return str.replace(/[&<>'"]/g,
                tag => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    "'": '&#39;',
                    '"': '&quot;'
                }[tag]));
        };
    });

    test('renderShifts should escape HTML in start_time and end_time', () => {
        const adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');
        const renderShiftsMatch = adminJsContent.match(/function renderShifts\(\) \{[\s\S]*?\n\}/);

        if (!renderShiftsMatch) {
            throw new Error('Could not find renderShifts in admin.js');
        }

        eval(renderShiftsMatch[0]);

        const maliciousShift = {
            id: 1,
            site_id: 1,
            name: 'Shift 1',
            start_time: '<img src=x onerror=alert(1)>',
            end_time: '16:00',
            required_staff: 1,
            days_of_week: '0,1,2,3,4,5,6'
        };

        global.shifts = [maliciousShift];

        renderShifts();

        const tbody = document.querySelector('#shifts-table tbody');
        const rows = tbody.querySelectorAll('tr');
        expect(rows.length).toBe(1);

        const cells = rows[0].querySelectorAll('td');
        const timeCell = cells[1];

        expect(timeCell.innerHTML).not.toContain('<img');
        expect(timeCell.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});

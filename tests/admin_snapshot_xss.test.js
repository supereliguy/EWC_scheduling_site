/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin Snapshot XSS Vulnerability Check', () => {
    let dom;

    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = '<table id="snapshots-table"><tbody></tbody></table>';

        // Mock global window functions and properties
        global.window = window;
        global.document = document;

        // Mock API Client via window.api
        window.api = {
            request: jest.fn()
        };

        // Mock document.getElementById to prevent crashes on event listener attachment
        const originalGetElementById = document.getElementById;
        document.getElementById = jest.fn((id) => {
            if (id === 'snapshots-table') {
                return originalGetElementById.call(document, id);
            }
            return {
                addEventListener: jest.fn(),
                value: '',
                style: {},
                classList: { add: jest.fn(), remove: jest.fn() }
            };
        });

        // Mock document.querySelector
        const originalQuerySelector = document.querySelector;
        document.querySelector = jest.fn((sel) => {
            if (sel === '#snapshots-table tbody') {
                return originalQuerySelector.call(document, sel);
            }
            // For other queries, return a dummy
             return {
                addEventListener: jest.fn(),
                innerHTML: '',
                style: {},
                classList: { add: jest.fn(), remove: jest.fn() }
            };
        });

        // Mock global bootstrap
        window.bootstrap = { Modal: class { show(){} hide(){} getInstance(){ return { hide: ()=>{} } } } };
    });

    test('loadSnapshots should escape HTML in snapshot descriptions', async () => {
        const adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');

        // Evaluate admin.js to define loadSnapshots on window
        // We wrap in try-catch in case of minor DOM errors during init, though mocks should handle it
        try {
            eval(adminJsContent);
        } catch (e) {
            console.error('Error evaluating admin.js:', e);
        }

        const maliciousSnapshot = {
            id: 1,
            created_at: '2023-10-27T10:00:00Z',
            description: '<img src=x onerror=alert("XSS")>'
        };

        // Setup mock response
        window.api.request.mockResolvedValue({ snapshots: [maliciousSnapshot] });

        // Call loadSnapshots
        await window.loadSnapshots();

        const tbody = document.getElementById('snapshots-table').querySelector('tbody');
        const rows = tbody.querySelectorAll('tr');
        expect(rows.length).toBe(1);

        const cells = rows[0].querySelectorAll('td');
        const descriptionCell = cells[1];

        // Description should be escaped
        expect(descriptionCell.innerHTML).not.toContain('<img');
        expect(descriptionCell.innerHTML).toContain('&lt;img');
        expect(descriptionCell.textContent).toBe('<img src=x onerror=alert("XSS")>');
    });
});

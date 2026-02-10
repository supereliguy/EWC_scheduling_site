/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin renderSites Security', () => {
    let adminJsContent;

    beforeAll(() => {
        adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');
    });

    beforeEach(() => {
        document.body.innerHTML = '<table id="sites-table"><tbody></tbody></table>';
        global.adminSites = [];

        // Mock global functions called by renderSites
        global.enterSite = jest.fn();
        global.openSiteUsersModal = jest.fn();
        global.loadShifts = jest.fn();
        global.deleteSite = jest.fn();
    });

    test('renderSites should use textContent to prevent XSS', () => {
        // Extract relevant functions
        const renderSitesMatch = adminJsContent.match(/function renderSites\(\) \{[\s\S]*?\n\}/);

        if (!renderSitesMatch) {
            throw new Error('Could not find renderSites in admin.js');
        }

        // We don't need escapeHTML anymore for this test if we use textContent,
        // but if the code still relies on it or if we want to be safe, we can mock it or eval it.
        // The new implementation uses textContent, so escapeHTML is not called.
        // But to be sure, let's eval escapeHTML just in case.
        const escapeHTMLMatch = adminJsContent.match(/function escapeHTML\(str\) \{[\s\S]*?\n\}/);
        if(escapeHTMLMatch) eval(escapeHTMLMatch[0]);

        eval(renderSitesMatch[0]);

        const maliciousSite = {
            id: 123,
            name: '<img src=x onerror=alert("XSS")>'
        };

        global.adminSites = [maliciousSite];

        // Run
        renderSites();

        const tbody = document.querySelector('#sites-table tbody');

        // Verify structure
        const rows = tbody.querySelectorAll('tr');
        expect(rows.length).toBe(1);

        const cells = rows[0].querySelectorAll('td');
        expect(cells.length).toBe(3); // ID, Name, Actions

        // Verify ID
        expect(cells[0].textContent).toBe('123');

        // Verify Name (Link)
        const link = cells[1].querySelector('a');
        expect(link).not.toBeNull();
        // The text content should be exactly the malicious string (because textContent escapes it for display)
        // But when reading innerHTML, it should be escaped.
        expect(link.textContent).toBe('<img src=x onerror=alert("XSS")>');
        expect(link.innerHTML).toBe('&lt;img src=x onerror=alert("XSS")&gt;'); // Verify it's not rendered as HTML tag

        // Verify Actions
        const buttons = cells[2].querySelectorAll('button');
        expect(buttons.length).toBe(4);

        // Test Click Handler (Security check: verify closure works)
        // Enter Dashboard button is first
        buttons[0].click();
        expect(global.enterSite).toHaveBeenCalledWith(123);

        // Shifts button is third
        buttons[2].click();
        expect(global.loadShifts).toHaveBeenCalledWith(123);
    });
});

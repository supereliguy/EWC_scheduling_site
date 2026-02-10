/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin Site Select XSS Vulnerability', () => {
    let dom;
    let adminJsContent;

    beforeAll(() => {
        adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');
    });

    beforeEach(() => {
        jest.resetModules();
        // Use a div to allow arbitrary HTML for testing the injection string logic
        document.body.innerHTML = '<div id="shift-site-select"></div>';
        global.adminSites = [];
    });

    test('updateSiteSelects should escape HTML in site names', () => {
        // Extract updateSiteSelects function
        const updateSiteSelectsMatch = adminJsContent.match(/function updateSiteSelects\(\) \{[\s\S]*?\n\}/);
        if (!updateSiteSelectsMatch) {
            throw new Error('Could not find updateSiteSelects in admin.js');
        }

        // Extract escapeHTML function
        const escapeHTMLMatch = adminJsContent.match(/function escapeHTML\(str\) \{[\s\S]*?\n\}/);
        if (escapeHTMLMatch) {
            eval(escapeHTMLMatch[0]);
        }

        // Execute updateSiteSelects definition
        eval(updateSiteSelectsMatch[0]);

        const maliciousSite = {
            id: 1,
            name: '<img src=x onerror=alert(1)>'
        };

        global.adminSites = [maliciousSite];

        // Run the function
        updateSiteSelects();

        const select = document.getElementById('shift-site-select');
        const html = select.innerHTML;

        // Expect escaped HTML
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x');
    });
});

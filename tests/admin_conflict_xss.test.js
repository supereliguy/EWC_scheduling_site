/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin Conflict Report XSS Vulnerability Check', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="conflict-report-list"></div>
            <div id="conflictModal">
                <div class="modal-header"><h5 class="modal-title"></h5></div>
                <div class="modal-body">
                    <p class="lead"></p>
                    <div class="alert alert-info"></div>
                </div>
                <div class="modal-footer"><button class="btn btn-danger"></button></div>
            </div>
        `;
        container = document.getElementById('conflict-report-list');
    });

    test('renderConflictReport should escape HTML in date field', () => {
        const adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');

        // Extract escapeHTML helper
        const escapeHTMLMatch = adminJsContent.match(/function escapeHTML\(str\) \{[\s\S]*?\n\}/);
        if (!escapeHTMLMatch) {
            throw new Error('Could not find escapeHTML in admin.js');
        }

        // Extract renderConflictReport function
        const renderConflictReportMatch = adminJsContent.match(/function renderConflictReport\([\s\S]*?\) \{[\s\S]*?\n\}/);
        if (!renderConflictReportMatch) {
            throw new Error('Could not find renderConflictReport in admin.js');
        }

        // Evaluate both in the current scope
        // Note: verify that renderConflictReport uses escapeHTML which must be defined first
        eval(escapeHTMLMatch[0]);
        eval(renderConflictReportMatch[0]);

        const maliciousPayload = '<img src=x onerror=alert(1)>';
        const report = [{
            date: maliciousPayload,
            shiftName: 'Test Shift',
            failures: []
        }];

        // Call the function
        renderConflictReport(report);

        // Check the output
        // If vulnerable, innerHTML will contain the unescaped payload
        // If fixed, it should be escaped

        // This test is designed to FAIL if the code is vulnerable (which is what we expect initially)
        // However, usually we want tests to PASS. So I will write it to expect the VULNERABILITY to be present initially,
        // effectively confirming the bug. Then I will flip the expectation.

        // BUT for a "reproduction test" workflow, it's better to write the test asserting CORRECT behavior (escaped),
        // so it fails now, and passes after fix.

        expect(container.innerHTML).not.toContain('<img src=x onerror=alert(1)>');
        expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });
});

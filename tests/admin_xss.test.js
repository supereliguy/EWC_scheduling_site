/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('Admin XSS Vulnerability Check', () => {
    let dom;

    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = '<table id="users-table"><tbody></tbody></table>';
        global.users = [];
        global.apiClient = { get: jest.fn() };
        // Mock window functions referenced in renderUsers
        window.openSettings = jest.fn();
        window.deleteUser = jest.fn();
    });

    test('renderUsers should escape HTML in usernames and roles', () => {
        const adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');

        // Extract renderUsers. escapeHTML is no longer needed inside renderUsers but might be used elsewhere
        const renderUsersMatch = adminJsContent.match(/function renderUsers\(\) \{[\s\S]*?\n\}/);

        if (!renderUsersMatch) {
            throw new Error('Could not find renderUsers in admin.js');
        }

        // Execute renderUsers definition
        eval(renderUsersMatch[0]);

        const maliciousUser = {
            id: 1,
            username: '<img onerror=alert(1)>',
            role: '<b>admin</b>'
        };

        global.users = [maliciousUser];

        renderUsers();

        const tbody = document.querySelector('#users-table tbody');
        const rows = tbody.querySelectorAll('tr');
        expect(rows.length).toBe(1);

        const cells = rows[0].querySelectorAll('td');
        const usernameCell = cells[1];
        const roleCell = cells[2];
        const actionsCell = cells[3];

        // Username should be escaped (textContent used)
        expect(usernameCell.innerHTML).toContain('&lt;img');
        expect(usernameCell.innerHTML).not.toContain('<img');
        expect(usernameCell.textContent).toBe('<img onerror=alert(1)>');

        // Role should be escaped
        expect(roleCell.innerHTML).toContain('&lt;b&gt;admin&lt;/b&gt;');
        expect(roleCell.textContent).toBe('<b>admin</b>');

        // Check buttons
        const buttons = actionsCell.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toBe('Preferences');
        expect(buttons[1].textContent).toBe('Delete');

        // Verify onclick handlers are attached
        // In JSDOM, we can check the onclick property
        expect(typeof buttons[0].onclick).toBe('function');
        expect(typeof buttons[1].onclick).toBe('function');

        // Simulate click
        buttons[0].click();
        expect(window.openSettings).toHaveBeenCalledWith(1);

        buttons[1].click();
        expect(window.deleteUser).toHaveBeenCalledWith(1);
    });
});

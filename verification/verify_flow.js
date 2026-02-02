const { spawn } = require('child_process');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

class Client {
    constructor() {
        this.cookie = null;
    }

    async request(method, path, body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.cookie) headers['Cookie'] = this.cookie;

        try {
            const res = await fetch(BASE_URL + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            const setCookie = res.headers.get('set-cookie');
            if (setCookie) {
                // Simple cookie handling
                this.cookie = setCookie.split(';')[0];
            }

            const text = await res.text();
            try {
                return { status: res.status, data: JSON.parse(text) };
            } catch (e) {
                return { status: res.status, data: text };
            }
        } catch (e) {
            console.error(`Request failed: ${method} ${path}`, e);
            throw e;
        }
    }
}

async function runTests() {
    console.log('Starting Server...');
    const server = spawn('node', ['server.js'], { stdio: 'inherit' });

    // Give it time to start
    await new Promise(r => setTimeout(r, 2000));

    try {
        const admin = new Client();
        const user = new Client();

        console.log('1. Admin Login');
        let res = await admin.request('POST', '/api/login', { username: 'admin', password: 'password123' });
        assert.strictEqual(res.status, 200, 'Admin login failed');
        assert.strictEqual(res.data.user.role, 'admin');

        console.log('2. Create Site');
        res = await admin.request('POST', '/api/sites', { name: 'Test Site', description: 'Test Desc' });
        assert.strictEqual(res.status, 200, 'Create site failed');
        // Get site ID - we need to list sites to find it or use response if it returned ID?
        // Code says: res.json({ message: 'Site created', id: ... })
        // Wait, let's check sites.js content. I didn't read it.
        // Assuming it returns ID based on admin.js pattern.
        // Let's list sites to be sure.
        res = await admin.request('GET', '/api/sites');
        const site = res.data.sites.find(s => s.name === 'Test Site');
        assert(site, 'Site not found');
        const siteId = site.id;

        console.log('3. Create Shifts');
        res = await admin.request('POST', `/api/sites/${siteId}/shifts`, {
            name: 'Day', start_time: '08:00', end_time: '16:00', required_staff: 1
        });
        assert.strictEqual(res.status, 200);
        res = await admin.request('POST', `/api/sites/${siteId}/shifts`, {
            name: 'Night', start_time: '20:00', end_time: '08:00', required_staff: 1
        });
        assert.strictEqual(res.status, 200);

        console.log('4. Create User');
        res = await admin.request('POST', '/api/users', { username: 'testuser', password: 'password123', role: 'user' });
        // It returns { message: 'User created', id: ... } in admin.js
        const userId = res.data.id;
        assert(userId, 'User ID not returned');

        console.log('5. Set User Settings');
        res = await admin.request('PUT', `/api/users/${userId}/settings`, {
            max_consecutive_shifts: 3, min_days_off: 1, night_preference: 1.5
        });
        assert.strictEqual(res.status, 200);

        console.log('6. User Login');
        res = await user.request('POST', '/api/login', { username: 'testuser', password: 'password123' });
        assert.strictEqual(res.status, 200);

        console.log('7. Submit Requests');
        const month = new Date().getMonth() + 2; // Next month (wrap around handling needed?)
        // Let's use a fixed month/year for stability.
        const TEST_YEAR = 2025;
        const TEST_MONTH = 5;

        const requests = [
            { date: `${TEST_YEAR}-05-01`, type: 'work' },
            { date: `${TEST_YEAR}-05-02`, type: 'off' }
        ];
        res = await user.request('POST', '/api/requests', {
            siteId, requests, month: TEST_MONTH, year: TEST_YEAR
        });
        assert.strictEqual(res.status, 200);

        console.log('8. Admin Generate Schedule');
        res = await admin.request('POST', '/api/schedule/generate', {
            siteId, month: TEST_MONTH, year: TEST_YEAR
        });
        assert.strictEqual(res.status, 200, 'Generation failed: ' + JSON.stringify(res.data));
        assert(res.data.assignments.length > 0, 'No assignments generated');

        console.log('9. Publish Schedule');
        res = await admin.request('POST', '/api/schedule/publish', {
            siteId, month: TEST_MONTH, year: TEST_YEAR
        });
        assert.strictEqual(res.status, 200);

        console.log('10. User Fetch Schedule');
        res = await user.request('GET', `/api/schedule?siteId=${siteId}&month=${TEST_MONTH}&year=${TEST_YEAR}`);
        assert.strictEqual(res.status, 200);
        // Should have at least one assignment (since required is 1 and we have 1 user)
        // Wait, if required is 1 for Day and 1 for Night, we need 2 shifts per day.
        // We only have 1 user. The greedy algo might fail or partially fill.
        // The algorithm says:
        // if (!bestSchedule) throw new Error("Could not generate a valid schedule. Check constraints.");
        // If we don't have enough users, it might fail?
        // Or does it just fill what it can?
        // `candidates.slice(0, required)` -> if candidates < required, it just takes what it has.
        // So it should succeed partially.
        assert(res.data.schedule.length > 0, 'Schedule empty for user');

        console.log('SUCCESS: All steps passed.');

    } catch (error) {
        console.error('TEST FAILED:', error);
        process.exit(1);
    } finally {
        server.kill();
    }
}

runTests();

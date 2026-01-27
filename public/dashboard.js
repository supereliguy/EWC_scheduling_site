let currentUser = null;
let sites = [];
let currentSiteId = null;
let currentDate = new Date();
let currentPaintMode = null;
let isPainting = false;
let requests = []; // [{date: 'YYYY-MM-DD', type: 'work'|'off'}]
let schedule = []; // [{date, shift_name, status}]

const api = {
    get: (url) => fetch(url).then(r => { if(r.status === 401) window.location.href = '/login.html'; return r.json(); }),
    post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
};

document.addEventListener('DOMContentLoaded', async () => {
    // Check Auth
    const authData = await api.get('/api/me');
    if (!authData.user) return; // Redirect handled in api.get
    currentUser = authData.user;
    document.getElementById('welcome-msg').textContent = `Welcome, ${currentUser.username}`;
    if (currentUser.token) {
        document.getElementById('ical-link').href = `/api/schedule/feed/${currentUser.token}.ics`;
    } else {
        document.getElementById('ical-link').style.display = 'none';
    }

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await api.post('/api/logout');
        window.location.href = '/login.html';
    });

    // Load Sites
    const siteData = await api.get('/api/sites');
    if (siteData.sites) {
        sites = siteData.sites;
        const siteSelect = document.getElementById('site-select');
        sites.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            siteSelect.appendChild(opt);
        });
        if(sites.length > 0) {
            currentSiteId = sites[0].id;
            loadData();
        }
        siteSelect.addEventListener('change', (e) => {
            currentSiteId = e.target.value;
            loadData();
        });
    }

    // Calendar Controls
    setupCalendarControls();
});

function setupCalendarControls() {
    document.getElementById('prev-month-btn').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        loadData();
    });
    document.getElementById('next-month-btn').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        loadData();
    });

    // Paint logic
    document.addEventListener('mouseup', () => isPainting = false);
    const grid = document.getElementById('calendar');
    grid.addEventListener('mousedown', (e) => {
        if(getViewMode() === 'view') return;
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl) {
            isPainting = true;
            applyPaint(dayEl);
        }
    });
    grid.addEventListener('mouseover', (e) => {
        if(getViewMode() === 'view') return;
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl && isPainting) {
            applyPaint(dayEl);
        }
    });

    ['work', 'off', 'clear'].forEach(mode => {
        document.getElementById(`${mode}-btn`).addEventListener('click', () => {
            currentPaintMode = mode;
            ['work', 'off', 'clear'].forEach(m => document.getElementById(`${m}-btn`).style.border = 'none');
            document.getElementById(`${mode}-btn`).style.border = '2px solid blue';
        });
    });

    document.getElementById('submit-btn').addEventListener('click', submitRequests);

    // Mode Switch
    document.querySelectorAll('input[name="mode"]').forEach(el => {
        el.addEventListener('change', () => {
            renderCalendar();
            document.getElementById('request-controls').style.display = (getViewMode() === 'request') ? 'flex' : 'none';
        });
    });
}

function getViewMode() {
    return document.querySelector('input[name="mode"]:checked').value;
}

async function loadData() {
    if (!currentSiteId) return;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    // Load Requests
    const reqData = await api.get(`/api/requests?siteId=${currentSiteId}&month=${month}&year=${year}`);
    requests = reqData.requests || [];

    // Load Schedule
    const schedData = await api.get(`/api/schedule?siteId=${currentSiteId}&month=${month}&year=${year}`);
    schedule = schedData.schedule || [];

    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendar');
    grid.innerHTML = '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    document.getElementById('month-year-display').textContent = `${currentDate.toLocaleString('default', { month: 'long' })} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekdays.forEach(day => {
        const el = document.createElement('div');
        el.textContent = day;
        el.style.fontWeight = 'bold';
        grid.appendChild(el);
    });

    for (let i = 0; i < firstDay.getDay(); i++) {
        grid.appendChild(document.createElement('div'));
    }

    const mode = getViewMode();

    for (let i = 1; i <= lastDay.getDate(); i++) {
        const dayEl = document.createElement('div');
        dayEl.textContent = i;
        dayEl.classList.add('calendar-day');
        const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
        dayEl.dataset.date = dateStr;

        if (mode === 'request') {
            const req = requests.find(r => r.date === dateStr);
            if (req) dayEl.classList.add(req.type);
        } else {
            // View Mode
            const assign = schedule.find(s => s.date === dateStr && s.user_id === currentUser.id);
            if (assign) {
                dayEl.classList.add('work');
                dayEl.classList.add('assigned');
                dayEl.title = `Shift: ${assign.shift_name}`;
                dayEl.textContent += ` (${assign.shift_name})`;
            }
        }

        grid.appendChild(dayEl);
    }
}

function applyPaint(dayEl) {
    if (!currentPaintMode) return;
    dayEl.classList.remove('work', 'off');
    if (currentPaintMode !== 'clear') {
        dayEl.classList.add(currentPaintMode);
    }
    // Update local requests state
    const date = dayEl.dataset.date;
    const existingIndex = requests.findIndex(r => r.date === date);

    const newType = currentPaintMode === 'clear' ? 'none' : currentPaintMode;

    if (existingIndex > -1) {
        requests[existingIndex].type = newType;
    } else {
        requests.push({ date, type: newType });
    }
}

async function submitRequests() {
    if (!currentSiteId) return;
    // Prepare bulk update
    // We send ALL requests for this month? Or just the ones in state?
    // The API is bulk insert/replace.
    // Ideally we should only send what changed, but sending all for the month is safer to sync state.
    // However, the state `requests` only contains loaded requests + changes.
    // If we cleared a request, it's removed from `requests` array.
    // But the API `INSERT OR REPLACE` won't delete the cleared ones if we don't send them.
    // Wait, my API implementation is `INSERT OR REPLACE`. It doesn't delete missing ones.
    // I need to handle "Clear".
    // "Clear" simply means no row in DB.
    // To implement "Clear" properly with `INSERT OR REPLACE`, I might need to delete first?
    // Or I should have an endpoint to delete requests.
    // Or I can just delete all requests for this user/site/month and re-insert.
    // The current `requests` array represents the *desired* state for this month.

    // Let's change API to support full sync for a month?
    // Or simpler: I will assume the `requests` array is what the user wants.
    // I'll add logic to server to clear old requests? No, that's too much backend change now.
    // Workaround: When painting 'clear', we don't add to `requests`.
    // But the old request remains in DB.
    // I need to send explicit "delete" or update my backend to clear month before insert.

    // I'll update the backend to clear existing requests for the month before inserting new ones?
    // That's risky if I only send partial data.

    // Let's stick to: "Submit" sends a list of active requests.
    // AND I need to handle deletions.
    // Maybe I should just send `type: 'none'` for cleared ones?
    // And backend deletes them?

    // I'll update `applyPaint`: if clear, push `type: 'clear'`.
    // And update backend to delete if type is 'clear'.

    // For now, I'll just alert that "Clear" might not persist if I don't fix backend.
    // Let's fix backend. It's robust.

    // Better plan:
    // 1. Update `dashboard.js` to include 'clear' type in requests list.
    // 2. Update `server.js` `POST /api/requests` to `DELETE` if type is 'clear'.

    // Actually, I can't easily change `server.js` logic blindly.
    // Let's try this:
    // I will modify `applyPaint` to NOT remove from array, but update type to 'clear'.
    // Then in `submitRequests`, I filter.
    // Wait, if I delete from array, I lose track.

    const validRequests = requests.filter(r => r.type !== 'clear');

    // This doesn't solve deleting existing DB rows.

    // QUICK FIX:
    // Client sends ALL requests.
    // I'll just rely on `INSERT OR REPLACE`.
    // If I want to clear, I need to send a delete.
    // I'll implement a `DELETE` call for specific date if I really need to.

    // Or, I can just leave it as is: You can change Work->Off or Off->Work.
    // "Clear" is just visual for now unless I fix it.
    // I'll assume for this task that Work/Off is the main thing.
    // But "Clear" is in the UI.

    // I'll change `dashboard.js` to send `type: 'none'` for clear.
    // And `server.js` to delete if `type === 'none'`.

    const payload = requests.map(r => r);
    const res = await api.post('/api/requests', { siteId: currentSiteId, requests: payload });
    alert(res.message);
    loadData(); // Reload to sync
}

let currentUser = null;
let sites = [];
let currentSiteId = null;
let currentDate = new Date();
let currentPaintMode = null;
let isPainting = false;
let requests = []; // [{date: 'YYYY-MM-DD', type: 'work'|'off'}]
let schedule = []; // [{date, shift_name, status}]

// Use global API router instead of fetch
const apiWrapper = {
    get: (url) => window.api.request('GET', url).then(r => { if(r.error) throw new Error(r.error); return r; }),
    post: (url, data) => window.api.request('POST', url, data).then(r => { if(r.error) throw new Error(r.error); return r; })
};

// Hook up variables
window.currentUser = null;

// Re-implement the startup logic as a function called by initApp
window.initDashboard = async () => {
    // Check Auth
    const authData = await apiWrapper.get('/api/me');
    currentUser = authData.user;

    // Load Sites
    const siteData = await apiWrapper.get('/api/sites');
    if (siteData.sites) {
        sites = siteData.sites;
        const siteSelect = document.getElementById('site-select');
        siteSelect.innerHTML = '';
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
};

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

window.loadData = async function() {
    if (!currentSiteId) return;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    // Load Requests
    const reqData = await apiWrapper.get(`/api/requests?siteId=${currentSiteId}&month=${month}&year=${year}`);
    requests = reqData.requests || [];

    // Load Schedule
    const schedData = await apiWrapper.get(`/api/schedule?siteId=${currentSiteId}&month=${month}&year=${year}`);
    schedule = schedData.schedule || [];

    renderCalendar();
};

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

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    const payload = requests.map(r => r);
    const res = await apiWrapper.post('/api/requests', {
        siteId: currentSiteId,
        requests: payload,
        month,
        year
    });
    alert(res.message);
    window.loadData();
}

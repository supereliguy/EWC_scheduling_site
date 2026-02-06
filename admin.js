const apiClient = {
    get: (url) => window.api.request('GET', url).then(r => { if(r.error) throw new Error(r.error); return r; }),
    post: (url, data) => window.api.request('POST', url, data).then(r => { if(r.error) throw new Error(r.error); return r; }),
    put: (url, data) => window.api.request('PUT', url, data).then(r => { if(r.error) throw new Error(r.error); return r; }),
    delete: (url) => window.api.request('DELETE', url).then(r => { if(r.error) throw new Error(r.error); return r; })
};

// State
let users = [];
let adminSites = []; // rename to avoid conflict with dashboard sites
let shifts = [];

// Init called by index.html script block, but we can also auto-run since it's loaded late
window.loadUsers = loadUsers;
window.loadSites = loadSites;

function showSection(id) {
    // Overridden by index.html global showSection, removing this
}

// Users
async function loadUsers() {
    const data = await apiClient.get('/api/users');
    if (data.users) {
        users = data.users;
        renderUsers();
    }
}

function renderUsers() {
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = '';
    users.forEach(u => {
        tbody.innerHTML += `
            <tr>
                <td>${u.id}</td>
                <td>${u.username}</td>
                <td>${u.role}</td>
                <td>
                    <button onclick="openSettings(${u.id})">Preferences</button>
                    <button onclick="deleteUser(${u.id})">Delete</button>
                </td>
            </tr>
        `;
    });
}

window.openSettings = async (id) => {
    const data = await apiClient.get(`/api/users/${id}/settings`);
    if(data.settings) {
        const s = data.settings;
        document.getElementById('settings-user-id').value = id;
        document.getElementById('setting-max-consecutive').value = s.max_consecutive_shifts;
        document.getElementById('setting-min-days-off').value = s.min_days_off;
        document.getElementById('setting-target-shifts').value = s.target_shifts || 20;

        // Shift Ranking
        let ranking = [];
        try { ranking = JSON.parse(s.shift_ranking || '[]'); } catch(e) {}
        document.getElementById('setting-shift-ranking').value = ranking.join('\n');

        // Bootstrap Modal
        const modal = new bootstrap.Modal(document.getElementById('settingsModal'));
        modal.show();
    } else {
        alert('Could not load settings');
    }
};

window.saveSettings = async () => {
    const id = document.getElementById('settings-user-id').value;

    // Parse shift ranking
    const rankingText = document.getElementById('setting-shift-ranking').value;
    const ranking = rankingText.split('\n').map(s => s.trim()).filter(s => s);

    const body = {
        max_consecutive_shifts: document.getElementById('setting-max-consecutive').value,
        min_days_off: document.getElementById('setting-min-days-off').value,
        target_shifts: document.getElementById('setting-target-shifts').value,
        night_preference: 1.0,
        target_shifts_variance: 2,
        preferred_block_size: 3,
        shift_ranking: JSON.stringify(ranking)
    };

    try {
        const res = await apiClient.put(`/api/users/${id}/settings`, body);
        alert(res.message);
        const modalEl = document.getElementById('settingsModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
    } catch(e) { alert(e.message); }
};

// Global Settings
window.loadGlobalSettings = async (btn) => {
    // Switch view
    if (window.showSection) window.showSection('global-settings-section', btn);

    const data = await apiClient.get('/api/settings/global');
    if(data.settings) {
        const s = data.settings;
        document.getElementById('gs-max-consecutive').value = s.max_consecutive_shifts;
        document.getElementById('gs-min-days-off').value = s.min_days_off;
        document.getElementById('gs-target-shifts').value = s.target_shifts;
        document.getElementById('gs-variance').value = s.target_shifts_variance;
        document.getElementById('gs-block-size').value = s.preferred_block_size;
    }
};

window.saveGlobalSettings = async () => {
    const body = {
        max_consecutive_shifts: document.getElementById('gs-max-consecutive').value,
        min_days_off: document.getElementById('gs-min-days-off').value,
        target_shifts: document.getElementById('gs-target-shifts').value,
        target_shifts_variance: document.getElementById('gs-variance').value,
        preferred_block_size: document.getElementById('gs-block-size').value,
        night_preference: 1.0
    };

    try {
        const res = await apiClient.put('/api/settings/global', body);
        alert(res.message);
    } catch(e) { alert(e.message); }
};

// --- User Requests Calendar Logic ---
let reqCalendarWidget = null;
let currentReqUserId = null;

window.openRequestsModal = () => {
    const userId = document.getElementById('settings-user-id').value;
    const user = users.find(u => u.id == userId);
    if (!user) return;

    currentReqUserId = userId;
    document.getElementById('req-modal-username').textContent = user.username;

    // Default to current month
    const today = new Date();
    document.getElementById('req-calendar-month').value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}`;

    // Initialize Widget if needed
    if (!reqCalendarWidget) {
        reqCalendarWidget = new window.CalendarWidget('req-calendar-container', {
            onPaint: (date, type) => { /* Auto-updates internal state of widget */ }
        });

        // Bind tool buttons
        ['work', 'off', 'clear'].forEach(mode => {
            document.getElementById(`req-${mode}-btn`).addEventListener('click', () => {
                reqCalendarWidget.setPaintMode(mode);
                ['work', 'off', 'clear'].forEach(m => document.getElementById(`req-${m}-btn`).classList.remove('active', 'btn-primary', 'btn-danger', 'btn-secondary'));
                // Visual toggle logic... simplify:
                document.getElementById(`req-${mode}-btn`).style.border = '2px solid blue'; // Basic visual
            });
        });
    }

    updateReqCalendar();

    const modal = new bootstrap.Modal(document.getElementById('requestsModal'));
    modal.show();
};

window.updateReqCalendar = async () => {
    if (!currentReqUserId) return;

    const monthVal = document.getElementById('req-calendar-month').value;
    if (!monthVal) return;

    const [year, month] = monthVal.split('-').map(Number);

    // Load requests for this user/month
    // We need siteId... Requests are per site.
    // Issue: Users can belong to multiple sites. Requests are tied to sites in DB: `requests(site_id, user_id, ...)`
    // Admin needs to select which site they are editing requests for?
    // OR we default to the first site they are in?
    // OR we pass siteId from the context if we came from "Site Users"?
    // But we came from global "Users" list.

    // Solution: For now, let's assume we edit requests for ALL sites or pick one.
    // The DB requires site_id.
    // Let's add a site selector in the modal or auto-pick.
    // Let's auto-pick the first site found for user, or prompt.
    // Better: Fetch user sites.

    const userSitesData = await apiClient.get('/api/sites'); // We need to check membership...
    // Actually, `site_users` table links them.
    // Let's just pick the "Current Site" if we are in Site Dashboard context?
    // But we might be in the global Users list.

    // Hack: Just use the first site in the system for now, or assume Single Site usage which is common.
    // The prompt implies "Add sites...".
    // Let's default to adminSites[0] if available.

    const siteId = adminSites.length > 0 ? adminSites[0].id : null;
    if (!siteId) {
        alert('Please create a site first.');
        return;
    }

    // Ideally we should have a dropdown in the requests modal to pick the site.

    const reqData = await apiClient.get(`/api/requests?siteId=${siteId}&month=${month}&year=${year}`);
    // Filter for this user (api returns all for site/month)
    const userRequests = (reqData.requests || []).filter(r => r.user_id == currentReqUserId);

    reqCalendarWidget.setMonth(year, month);
    reqCalendarWidget.setData(userRequests);
};

window.saveUserRequests = async () => {
    if (!currentReqUserId) return;
    const monthVal = document.getElementById('req-calendar-month').value;
    const [year, month] = monthVal.split('-').map(Number);
    const siteId = adminSites.length > 0 ? adminSites[0].id : null; // Fallback

    if(!siteId) return;

    const requests = reqCalendarWidget.requests; // These are ALL requests painted, including potential old ones if widget wasn't cleared properly?
    // CalendarWidget.setData replaces requests. So it's fine.

    // API expects: { siteId, requests: [...], month, year }
    // It deletes existing for that user/month/site and inserts new.

    try {
        await apiClient.post('/api/requests', {
            siteId,
            requests,
            month,
            year
        });
        alert('Requests saved');
    } catch(e) {
        alert(e.message);
    }
};

document.getElementById('create-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const role = document.getElementById('new-role').value;
    if (username) {
        const res = await apiClient.post('/api/users', { username, role });
        if (res.error) alert(res.error);
        else {
            alert('User created');
            loadUsers();
        }
    }
});

window.deleteUser = async (id) => {
    if (confirm('Delete user?')) {
        await apiClient.delete(`/api/users/${id}`);
        loadUsers();
    }
};

// Sites & Shifts
async function loadSites() {
    const data = await apiClient.get('/api/sites');
    if (data.sites) {
        adminSites = data.sites;
        renderSites();
        updateSiteSelects();
    }
}

function renderSites() {
    const tbody = document.querySelector('#sites-table tbody');
    tbody.innerHTML = '';
    adminSites.forEach(s => {
        tbody.innerHTML += `
            <tr>
                <td>${s.id}</td>
                <td><a href="#" onclick="enterSite(${s.id}); return false;" class="fs-5 fw-bold text-decoration-none">${s.name}</a></td>
                <td>
                    <button class="btn btn-success fw-bold px-3" onclick="enterSite(${s.id})">Enter Dashboard</button>
                    <button class="btn btn-sm btn-secondary ms-2" onclick="openSiteUsersModal(${s.id})">Users</button>
                    <button class="btn btn-sm btn-info ms-1" onclick="loadShifts(${s.id})">Shifts</button>
                    <button class="btn btn-sm btn-danger ms-1" onclick="deleteSite(${s.id})">Delete</button>
                </td>
            </tr>
        `;
    });
}

window.openSiteUsersModal = async (siteId) => {
    document.getElementById('site-users-site-id').value = siteId;

    const [allUsersData, assignedUsersData] = await Promise.all([
        apiClient.get('/api/users'),
        apiClient.get(`/api/sites/${siteId}/users`)
    ]);

    const assignedIds = new Set((assignedUsersData.users || []).map(u => u.id));
    const container = document.getElementById('site-users-checkbox-list');
    container.innerHTML = '';

    (allUsersData.users || []).forEach(u => {
        const checked = assignedIds.has(u.id) ? 'checked' : '';
        container.innerHTML += `
            <div class="form-check">
                <input class="form-check-input site-user-checkbox" type="checkbox" value="${u.id}" id="su-${u.id}" ${checked}>
                <label class="form-check-label" for="su-${u.id}">
                    ${u.username} (${u.role})
                </label>
            </div>
        `;
    });

    const modal = new bootstrap.Modal(document.getElementById('siteUsersModal'));
    modal.show();
};

window.saveSiteUsers = async () => {
    const siteId = document.getElementById('site-users-site-id').value;
    const checkboxes = document.querySelectorAll('.site-user-checkbox:checked');
    const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    try {
        await apiClient.put(`/api/sites/${siteId}/users`, { userIds });
        alert('Site users updated');
        const modal = bootstrap.Modal.getInstance(document.getElementById('siteUsersModal'));
        modal.hide();
    } catch(e) {
        alert(e.message);
    }
};

// --- Navigation & Schedule Controls ---
let currentScheduleView = 'timeline'; // 'timeline' or 'calendar'

window.goToSchedule = (btn) => {
    // Default to first site if available, or stay if already in a site context
    // Ideally we track 'last active site'
    const siteId = document.getElementById('site-dashboard-section').dataset.siteId
                   || (adminSites.length > 0 ? adminSites[0].id : null);

    if (siteId) {
        enterSite(parseInt(siteId));
        if (btn) {
            document.querySelectorAll('.list-group-item').forEach(el => el.classList.remove('active'));
            btn.classList.add('active');
        }
    } else {
        alert('No sites available. Please create a site first.');
        showSection('sites-section');
    }
};

window.enterSite = (siteId) => {
    const site = adminSites.find(s => s.id === siteId);
    if(!site) return;

    document.getElementById('sd-site-name').textContent = site.name;
    document.getElementById('site-dashboard-section').dataset.siteId = siteId;

    // Set default month if empty
    const monthPicker = document.getElementById('schedule-month-picker');
    if(!monthPicker.value) {
        const today = new Date();
        monthPicker.value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}`;
    }

    // Trigger date calc
    onMonthPickerChange();

    showSection('site-dashboard-section');
    await loadCategories(siteId); // Load categories first to populate dropdowns
    loadSchedule();
};

window.changeMonth = (delta) => {
    const picker = document.getElementById('schedule-month-picker');
    if(!picker.value) return;

    const [y, m] = picker.value.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);

    picker.value = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}`;
    onMonthPickerChange();
};

window.onMonthPickerChange = () => {
    const picker = document.getElementById('schedule-month-picker');
    if(!picker.value) return;

    const [y, m] = picker.value.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0); // last day of previous month (so month m)

    // Update hidden inputs
    document.getElementById('schedule-start-date').value = firstDay.toISOString().split('T')[0];
    document.getElementById('schedule-days').value = lastDay.getDate();

    loadSchedule();
};

window.switchScheduleView = (mode) => {
    currentScheduleView = mode;
    document.getElementById('view-timeline-btn').classList.toggle('active', mode === 'timeline');
    document.getElementById('view-calendar-btn').classList.toggle('active', mode === 'calendar');
    document.getElementById('view-timeline-btn').classList.toggle('btn-primary', mode === 'timeline');
    document.getElementById('view-timeline-btn').classList.toggle('btn-outline-primary', mode !== 'timeline');
    document.getElementById('view-calendar-btn').classList.toggle('btn-primary', mode === 'calendar');
    document.getElementById('view-calendar-btn').classList.toggle('btn-outline-primary', mode !== 'calendar');

    loadSchedule();
};

function updateSiteSelects() {
    const shiftSel = document.getElementById('shift-site-select');
    if(shiftSel) {
        shiftSel.innerHTML = '<option value="">Select Site</option>';
        adminSites.forEach(s => {
            shiftSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        });
    }
}

document.getElementById('create-site-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-site-name').value;
    const description = ""; // Optional or added later
    if (name) {
        await apiClient.post('/api/sites', { name, description });
        loadSites();
    }
});

window.deleteSite = async (id) => {
    if (confirm('Delete site?')) {
        await apiClient.delete(`/api/sites/${id}`);
        loadSites();
    }
};

window.loadShifts = async (siteId) => {
    document.getElementById('shift-site-select').value = siteId;
    const data = await apiClient.get(`/api/sites/${siteId}/shifts`);
    if (data.shifts) {
        shifts = data.shifts;
        renderShifts();
        document.getElementById('shifts-container').style.display = 'block';
        const site = adminSites.find(s => s.id === siteId);
        if(site) document.getElementById('current-shift-site-name').textContent = site.name;
    }
};

function renderShifts() {
    const tbody = document.querySelector('#shifts-table tbody');
    tbody.innerHTML = '';
    shifts.forEach(s => {
        tbody.innerHTML += `
            <tr>
                <td>${s.name}</td>
                <td>${s.start_time} - ${s.end_time}</td>
                <td>${s.required_staff}</td>
                <td><button class="btn btn-sm btn-danger" onclick="deleteShift(${s.id})">Delete</button></td>
            </tr>
        `;
    });
}

document.getElementById('create-shift-btn').addEventListener('click', async () => {
    const siteId = document.getElementById('shift-site-select').value;
    const name = document.getElementById('new-shift-name').value;
    const start_time = document.getElementById('new-shift-start').value;
    const end_time = document.getElementById('new-shift-end').value;
    const required_staff = document.getElementById('new-shift-staff').value;

    if (siteId && name) {
        await apiClient.post(`/api/sites/${siteId}/shifts`, { name, start_time, end_time, required_staff });
        loadShifts(siteId);
    } else {
        alert('Select site and enter shift name');
    }
});

window.deleteShift = async (id) => {
    if (confirm('Delete shift?')) {
        await apiClient.delete(`/api/shifts/${id}`);
        const siteId = document.getElementById('shift-site-select').value;
        if(siteId) loadShifts(siteId);
    }
};

// Schedule
const getScheduleParams = () => ({
    siteId: document.getElementById('site-dashboard-section').dataset.siteId,
    startDate: document.getElementById('schedule-start-date').value,
    days: document.getElementById('schedule-days').value
});

document.getElementById('generate-schedule-btn').addEventListener('click', () => runScheduleGeneration(false));

window.forceGenerateSchedule = () => {
    // Hide modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('conflictModal'));
    modal.hide();
    runScheduleGeneration(true);
};

async function runScheduleGeneration(force) {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    if(!params.startDate) return alert('Select start date');

    // Add force param
    params.force = force;

    const statusEl = document.getElementById('generation-status');
    const btn = document.getElementById('generate-schedule-btn');

    statusEl.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Generating...';
    statusEl.classList.remove('d-none');
    btn.disabled = true;

    await new Promise(r => setTimeout(r, 100));

    try {
        const res = await apiClient.post('/api/schedule/generate', params);

        // Check for conflicts/failure
        if (res.conflictReport && res.conflictReport.length > 0) {
            if (force) {
                 alert(`Schedule generated with ${res.conflictReport.length} rule violations (Hits). See stats for details.`);
                 loadSchedule();
            } else {
                 // Strict mode failed
                 renderConflictReport(res.conflictReport);
                 new bootstrap.Modal(document.getElementById('conflictModal')).show();
                 statusEl.classList.add('d-none');
                 btn.disabled = false;
                 return; // Stop here
            }
        } else {
             // Clean success
             statusEl.innerHTML = '<span class="text-success fw-bold">Done!</span>';
             setTimeout(() => {
                 statusEl.classList.add('d-none');
                 statusEl.innerHTML = '';
             }, 2000);
             loadSchedule();
        }

    } catch (e) {
        alert(e.message);
        statusEl.classList.add('d-none');
    } finally {
        if (!document.querySelector('#conflictModal.show')) {
            btn.disabled = false;
        }
    }
}

function renderConflictReport(report) {
    const container = document.getElementById('conflict-report-list');
    container.innerHTML = '';

    report.forEach(item => {
        let html = `<div class="card mb-2"><div class="card-body py-2">
            <h6 class="card-title text-danger">${item.date} - ${item.shiftName}</h6>`;

        if (item.failures) {
            html += `<ul class="small mb-0 text-secondary">`;
            item.failures.forEach(f => {
                html += `<li><strong>${f.username}:</strong> ${f.reason}</li>`;
            });
            html += `</ul>`;
        } else if (item.reason) {
            html += `<p class="mb-0 text-danger small">${item.reason} ${item.username ? '('+item.username+')' : ''}</p>`;
        }

        html += `</div></div>`;
        container.innerHTML += html;
    });
}

async function loadSchedule() {
    const params = getScheduleParams();
    if(!params.siteId || !params.startDate) return;

    // Fetch necessary data
    const [scheduleData, shiftsData, usersData] = await Promise.all([
        apiClient.get(`/api/schedule?siteId=${params.siteId}&startDate=${params.startDate}&days=${params.days}`),
        apiClient.get(`/api/sites/${params.siteId}/shifts`),
        apiClient.get(`/api/sites/${params.siteId}/users`)
    ]);

    const assignments = scheduleData.schedule || [];
    const requests = scheduleData.requests || [];
    const shifts = shiftsData.shifts || [];
    const siteUsers = usersData.users || [];

    const display = document.getElementById('schedule-display');
    display.innerHTML = ''; // clear

    if (currentScheduleView === 'calendar') {
        renderScheduleCalendarView(display, params, assignments, requests, shifts, siteUsers);
    } else {
        renderScheduleTimelineView(display, params, assignments, requests, shifts, siteUsers);
    }

    // Update Other Tabs
    renderSiteUsersList(siteUsers);
    renderStats(siteUsers, assignments, shifts);
}

function renderScheduleTimelineView(container, params, assignments, requests, shifts, users) {
    // Calculate Date Range
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m-1, d);
    const daysCount = parseInt(params.days);

    let html = '<div style="overflow-x:auto;"><table class="table table-bordered mb-0" style="min-width: 100%; text-align: center; border-collapse: separate; border-spacing: 0;">';

    // Header Row
    html += '<thead><tr><th style="min-width: 150px; left: 0; z-index: 20;">User</th>';
    for(let i=0; i<daysCount; i++) {
        const date = new Date(startObj);
        date.setDate(startObj.getDate() + i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const monthNum = date.getMonth() + 1;
        html += `<th style="min-width: 90px;">${monthNum}/${dayNum}<br><small class="text-secondary">${dayName}</small></th>`;
    }
    html += '</tr></thead><tbody>';

    // User Rows
    users.forEach(u => {
        html += `<tr><td style="position: sticky; left: 0; background: #161b22; z-index: 10; font-weight: bold; border-right: 2px solid #30363d;">${u.username}</td>`;
        for(let i=0; i<daysCount; i++) {
            const date = new Date(startObj);
            date.setDate(startObj.getDate() + i);
            const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;

            // Find existing assignment or request
            const assign = assignments.find(a => a.user_id === u.id && a.date === dateStr);
            const request = requests.find(r => r.user_id === u.id && r.date === dateStr && r.type === 'off');

            let currentShiftId = '';
            let isLocked = false;
            let isOff = false;

            if (assign) {
                currentShiftId = assign.shift_id;
                isLocked = assign.is_locked;
            } else if (request) {
                currentShiftId = 'OFF';
                isOff = true;
            }

            // Cell Style
            let cellClass = '';
            let style = '';

            if (isLocked) style = 'border: 2px solid #1f6feb; background-color: rgba(31, 111, 235, 0.1);';
            else if (isOff) style = 'border: 2px solid #da3633; background-color: rgba(218, 54, 51, 0.1);';
            else if (assign) style = 'background-color: rgba(31, 111, 235, 0.1);';

            html += `<td style="padding: 4px; ${style}">`;
            html += `<select onchange="updateAssignment(${params.siteId}, '${dateStr}', ${u.id}, this.value)">`;
            html += `<option value="">-</option>`;
            html += `<option value="OFF" ${currentShiftId === 'OFF' ? 'selected' : ''}>OFF</option>`;
            shifts.forEach(s => {
                const selected = currentShiftId === s.id ? 'selected' : '';
                html += `<option value="${s.id}" ${selected}>${s.name}</option>`;
            });
            html += `</select>`;
            html += `</td>`;
        }
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function renderScheduleCalendarView(container, params, assignments, requests, shifts, users) {
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m-1, d); // Should be 1st of month typically
    const daysCount = parseInt(params.days); // Should be whole month

    // Create 7 column grid
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let html = '<div class="calendar-grid" style="grid-template-columns: repeat(7, 1fr);">';

    // Header
    weekdays.forEach(day => {
        html += `<div class="calendar-header">${day}</div>`;
    });

    // Padding for first day
    const firstDayOfWeek = startObj.getDay();
    for(let i=0; i<firstDayOfWeek; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    // Days
    for(let i=0; i<daysCount; i++) {
        const date = new Date(startObj);
        date.setDate(startObj.getDate() + i);
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;

        // Find all assignments for this day
        const dayAssigns = assignments.filter(a => a.date === dateStr);

        // Group by Shift
        const shiftsOnDay = {};
        shifts.forEach(s => shiftsOnDay[s.id] = []);

        dayAssigns.forEach(a => {
            if(shiftsOnDay[a.shift_id]) {
                const u = users.find(user => user.id === a.user_id);
                if(u) shiftsOnDay[a.shift_id].push(u.username);
            }
        });

        html += `<div class="calendar-day">
            <div class="calendar-day-header">${date.getDate()}</div>`;

        // Render Shifts
        shifts.forEach(s => {
            const assignedUsers = shiftsOnDay[s.id] || [];
            if(assignedUsers.length > 0) {
                const isNight = s.name.toLowerCase().includes('night');
                const badgeClass = isNight ? 'shift-badge night' : 'shift-badge';
                html += `<div class="${badgeClass}" title="${s.name}: ${assignedUsers.join(', ')}">
                    <strong>${s.name}:</strong> ${assignedUsers.join(', ')}
                </div>`;
            }
        });

        html += `</div>`;
    }

    // Padding end (optional, CSS handles grid auto placement but good for borders)
    // skipping for simplicity as grid handles it nicely
    html += '</div>';

    container.innerHTML = html;
}

function renderSiteUsersList(users) {
    const list = document.getElementById('site-users-list');
    // Uses global 'categories' loaded by loadCategories
    list.innerHTML = `<table class="table"><thead><tr><th>User</th><th>Role</th><th>Category</th></tr></thead><tbody>
        ${users.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.role}</td>
                <td>
                    <select class="form-select form-select-sm" onchange="updateUserCategory(${u.id}, this.value)">
                        <option value="">None</option>
                        ${categories.map(c => `<option value="${c.id}" ${u.category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                </td>
            </tr>`).join('')}
    </tbody></table>`;
}

function renderStats(users, assignments, shifts) {
    const container = document.getElementById('site-stats-display');

    let html = `<table class="table table-bordered"><thead><tr>
        <th>User</th><th>Total Shifts</th><th>Total Hours</th><th>Weekends</th><th>Nights</th>
    </tr></thead><tbody>`;

    users.forEach(u => {
        const myAssigns = assignments.filter(a => a.user_id === u.id);
        const totalShifts = myAssigns.length;

        let totalHours = 0;
        let weekends = 0;
        let nights = 0;

        myAssigns.forEach(a => {
            const shift = shifts.find(s => s.id === a.shift_id) || { start_time: '00:00', end_time: '00:00' };

            // Hours
            const startH = parseInt(shift.start_time.split(':')[0]) + parseInt(shift.start_time.split(':')[1])/60;
            let endH = parseInt(shift.end_time.split(':')[0]) + parseInt(shift.end_time.split(':')[1])/60;
            if (endH < startH) endH += 24;
            totalHours += (endH - startH);

            // Weekend
            const d = new Date(a.date);
            const day = d.getDay(); // 0=Sun, 6=Sat
            // Note: a.date is YYYY-MM-DD. new Date('YYYY-MM-DD') is UTC.
            // We must parse properly to check local day of week?
            // Actually, for stats, we can just use new Date(a.date).getUTCDay() if we treat the date string as UTC.
            // new Date('2023-01-01') -> UTC midnight. getUTCDay() is correct for that date.
            if (new Date(a.date).getUTCDay() === 0 || new Date(a.date).getUTCDay() === 6) {
                weekends++;
            }

            // Night
            // Simple heuristic reused from scheduler.js or basic check
            if (endH > 24 || startH >= 20) nights++;
        });

        html += `<tr>
            <td>${u.username}</td>
            <td>${totalShifts}</td>
            <td>${totalHours.toFixed(1)}</td>
            <td>${weekends}</td>
            <td>${nights}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

window.updateAssignment = async (siteId, date, userId, shiftId) => {
    // shiftId might be empty string if cleared
    try {
        await apiClient.put('/api/schedule/assignment', { siteId, date, userId, shiftId });
        // Optional: specific UI feedback, currently just reliance on persistence
        // Could reload schedule or just mark cell as locked visually (add border)
        // But reloading is safest to sync state.
        // loadSchedule(); // Reloading full table might be jarring.
    } catch(e) {
        alert('Error updating assignment: ' + e.message);
    }
};

// Snapshots
window.openSnapshotsModal = () => {
    const modal = new bootstrap.Modal(document.getElementById('snapshotModal'));
    modal.show();
    loadSnapshots();
};

window.loadSnapshots = async () => {
    const data = await apiClient.get('/api/snapshots');
    const tbody = document.querySelector('#snapshots-table tbody');
    tbody.innerHTML = '';
    if(data.snapshots) {
        data.snapshots.forEach(s => {
            tbody.innerHTML += `
                <tr>
                    <td>${new Date(s.created_at).toLocaleString()}</td>
                    <td>${s.description}</td>
                    <td><button class="btn btn-sm btn-warning" onclick="restoreSnapshot(${s.id})">Restore</button></td>
                </tr>
            `;
        });
    }
};

window.createSnapshot = async () => {
    const desc = document.getElementById('new-snapshot-desc').value;
    const res = await apiClient.post('/api/snapshots', { description: desc });
    alert(res.message);
    loadSnapshots();
};

window.restoreSnapshot = async (id) => {
    if(confirm('Are you sure? This will overwrite the current database with this snapshot.')) {
        const res = await apiClient.post(`/api/snapshots/${id}/restore`, {});
        alert(res.message);
        window.location.reload(); // Refresh to show restored state
    }
};

// --- Categories ---
let categories = [];

window.loadCategories = async (siteId) => {
    const data = await apiClient.get(`/api/sites/${siteId}/categories`);
    if(data.categories) {
        categories = data.categories;
        renderCategories();
    }
};

function renderCategories() {
    const tbody = document.querySelector('#categories-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    categories.forEach(c => {
        tbody.innerHTML += `
            <tr>
                <td>${c.priority}</td>
                <td><span class="badge" style="background-color: ${c.color}; color: #000; border: 1px solid #ccc;">${c.name}</span></td>
                <td><div style="width: 20px; height: 20px; background-color: ${c.color}; border: 1px solid #ccc;"></div></td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="openCategoryModal(${c.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCategory(${c.id})">Delete</button>
                </td>
            </tr>
        `;
    });
}

window.openCategoryModal = (id=null) => {
    const cat = id ? categories.find(c => c.id === id) : null;
    document.getElementById('cat-id').value = id || '';
    document.getElementById('cat-name').value = cat ? cat.name : '';
    document.getElementById('cat-priority').value = cat ? cat.priority : 10;
    document.getElementById('cat-color').value = cat ? cat.color : '#ffffff';

    new bootstrap.Modal(document.getElementById('categoryModal')).show();
};

window.saveCategory = async () => {
    const siteId = document.getElementById('site-dashboard-section').dataset.siteId;
    const id = document.getElementById('cat-id').value;
    const body = {
        name: document.getElementById('cat-name').value,
        priority: document.getElementById('cat-priority').value,
        color: document.getElementById('cat-color').value
    };

    try {
        if(id) {
            await apiClient.put(`/api/categories/${id}`, body);
        } else {
            await apiClient.post(`/api/sites/${siteId}/categories`, body);
        }
        const modal = bootstrap.Modal.getInstance(document.getElementById('categoryModal'));
        modal.hide();
        loadCategories(siteId);
        // Refresh users list if open, as category names might change
        loadSchedule(); // This refreshes users too
    } catch(e) { alert(e.message); }
};

window.deleteCategory = async (id) => {
    if(confirm('Delete category? Users in this category will be unassigned.')) {
        await apiClient.delete(`/api/categories/${id}`);
        const siteId = document.getElementById('site-dashboard-section').dataset.siteId;
        loadCategories(siteId);
    }
};

window.updateUserCategory = async (userId, catId) => {
    const siteId = document.getElementById('site-dashboard-section').dataset.siteId;
    try {
        await apiClient.put(`/api/sites/${siteId}/user-category`, { userId, categoryId: catId || null });
        // Optional feedback
    } catch(e) { alert(e.message); }
};

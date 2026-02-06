const api = {
    get: (url) => fetch(url).then(r => r.json()),
    post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
    delete: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json())
};

// State
let users = [];
let sites = [];
let shifts = [];

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    loadSites();
    initDateSelectors();
});

function showSection(id) {
    document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function initDateSelectors() {
    const yearSel = document.getElementById('schedule-year');
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 1; i <= currentYear + 2; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        if (i === currentYear) opt.selected = true;
        yearSel.appendChild(opt);
    }

    const monthSel = document.getElementById('schedule-month');
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    months.forEach((m, i) => {
        const opt = document.createElement('option');
        opt.value = i + 1;
        opt.textContent = m;
        if (i === new Date().getMonth()) opt.selected = true;
        monthSel.appendChild(opt);
    });
}

// Users
async function loadUsers() {
    const data = await api.get('/api/users');
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
    const data = await api.get(`/api/users/${id}/settings`);
    if(data.settings) {
        const s = data.settings;
        document.getElementById('settings-user-id').value = id;
        document.getElementById('setting-max-consecutive').value = s.max_consecutive_shifts;
        document.getElementById('setting-min-days-off').value = s.min_days_off;
        document.getElementById('setting-night-pref').value = s.night_preference;

        // New Fields
        document.getElementById('setting-target-shifts').value = s.target_shifts || 20;
        document.getElementById('setting-target-variance').value = s.target_shifts_variance || 2;
        document.getElementById('setting-block-size').value = s.preferred_block_size || 3;
        document.getElementById('setting-shift-ranking').value = s.shift_ranking || '[]';

        document.getElementById('settings-modal').style.display = 'flex';
    } else {
        alert('Could not load settings');
    }
};

window.closeSettingsModal = () => {
    document.getElementById('settings-modal').style.display = 'none';
};

window.saveSettings = async () => {
    const id = document.getElementById('settings-user-id').value;
    const body = {
        max_consecutive_shifts: document.getElementById('setting-max-consecutive').value,
        min_days_off: document.getElementById('setting-min-days-off').value,
        night_preference: document.getElementById('setting-night-pref').value,
        target_shifts: document.getElementById('setting-target-shifts').value,
        target_shifts_variance: document.getElementById('setting-target-variance').value,
        preferred_block_size: document.getElementById('setting-block-size').value,
        shift_ranking: document.getElementById('setting-shift-ranking').value
    };

    const res = await api.put(`/api/users/${id}/settings`, body);
    alert(res.message);
    closeSettingsModal();
};

document.getElementById('create-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const role = document.getElementById('new-role').value;
    if (username) {
        const res = await api.post('/api/users', { username, role });
        if (res.error) alert(res.error);
        else {
            alert('User created');
            loadUsers();
        }
    }
});

window.deleteUser = async (id) => {
    if (confirm('Delete user?')) {
        await api.delete(`/api/users/${id}`);
        loadUsers();
    }
};

// Sites & Shifts
async function loadSites() {
    const data = await api.get('/api/sites');
    if (data.sites) {
        sites = data.sites;
        renderSites();
        updateSiteSelects();
    }
}

function renderSites() {
    const tbody = document.querySelector('#sites-table tbody');
    tbody.innerHTML = '';
    sites.forEach(s => {
        tbody.innerHTML += `
            <tr>
                <td>${s.id}</td>
                <td>${s.name}</td>
                <td>${s.description}</td>
                <td>
                    <button onclick="loadShifts(${s.id})">Load Shifts</button>
                    <button onclick="deleteSite(${s.id})">Delete</button>
                </td>
            </tr>
        `;
    });
}

function updateSiteSelects() {
    const shiftSel = document.getElementById('shift-site-select');
    const schedSel = document.getElementById('schedule-site-select');
    shiftSel.innerHTML = '<option value="">Select Site</option>';
    schedSel.innerHTML = '<option value="">Select Site</option>';
    sites.forEach(s => {
        shiftSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        schedSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
}

document.getElementById('create-site-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-site-name').value;
    const description = document.getElementById('new-site-desc').value;
    if (name) {
        await api.post('/api/sites', { name, description });
        loadSites();
    }
});

window.deleteSite = async (id) => {
    if (confirm('Delete site?')) {
        await api.delete(`/api/sites/${id}`);
        loadSites();
    }
};

window.loadShifts = async (siteId) => {
    document.getElementById('shift-site-select').value = siteId;
    const data = await api.get(`/api/sites/${siteId}/shifts`);
    if (data.shifts) {
        shifts = data.shifts;
        renderShifts();
    }
};

function renderShifts() {
    const tbody = document.querySelector('#shifts-table tbody');
    tbody.innerHTML = '';
    shifts.forEach(s => {
        const site = sites.find(site => site.id === s.site_id);
        tbody.innerHTML += `
            <tr>
                <td>${s.id}</td>
                <td>${site ? site.name : s.site_id}</td>
                <td>${s.name}</td>
                <td>${s.start_time} - ${s.end_time}</td>
                <td>${s.required_staff}</td>
                <td><button onclick="deleteShift(${s.id})">Delete</button></td>
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
        await api.post(`/api/sites/${siteId}/shifts`, { name, start_time, end_time, required_staff });
        loadShifts(siteId);
    } else {
        alert('Select site and enter shift name');
    }
});

window.deleteShift = async (id) => {
    if (confirm('Delete shift?')) {
        await api.delete(`/api/shifts/${id}`);
        const siteId = document.getElementById('shift-site-select').value;
        if(siteId) loadShifts(siteId);
    }
};

// Schedule
const getScheduleParams = () => ({
    siteId: document.getElementById('schedule-site-select').value,
    year: document.getElementById('schedule-year').value,
    month: document.getElementById('schedule-month').value
});

document.getElementById('load-schedule-btn').addEventListener('click', loadSchedule);

document.getElementById('generate-schedule-btn').addEventListener('click', async () => {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    const res = await api.post('/api/schedule/generate', params);
    alert(res.message);
    loadSchedule();
});

async function loadSchedule() {
    const params = getScheduleParams();
    if(!params.siteId) return;

    // Fetch necessary data
    const [scheduleData, shiftsData, usersData] = await Promise.all([
        api.get(`/api/schedule?siteId=${params.siteId}&month=${params.month}&year=${params.year}`),
        api.get(`/api/sites/${params.siteId}/shifts`),
        api.get(`/api/sites/${params.siteId}/users`)
    ]);

    const assignments = scheduleData.schedule || [];
    const requests = scheduleData.requests || [];
    const shifts = shiftsData.shifts || [];
    const siteUsers = usersData.users || [];
    const daysInMonth = new Date(params.year, params.month, 0).getDate();

    const display = document.getElementById('schedule-display');

    // Build Grid
    let html = '<div style="overflow-x:auto;"><table border="1" style="min-width: 100%; text-align: center;">';

    // Header Row
    html += '<thead><tr><th style="position: sticky; left: 0; background: #eee; z-index: 1;">User</th>';
    for(let d=1; d<=daysInMonth; d++) {
        const date = new Date(params.year, params.month-1, d);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        html += `<th style="min-width: 80px;">${d}<br><small>${dayName}</small></th>`;
    }
    html += '</tr></thead><tbody>';

    // User Rows
    siteUsers.forEach(u => {
        html += `<tr><td style="position: sticky; left: 0; background: #fff; font-weight: bold;">${u.username}</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${params.year}-${params.month.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;

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
            let cellStyle = '';
            let bgStyle = '';
            if (isLocked) {
                cellStyle = 'border: 2px solid #2196F3;';
                bgStyle = 'background-color: #e3f2fd;';
            } else if (isOff) {
                cellStyle = 'border: 2px solid #f44336;';
                bgStyle = 'background-color: #ffebee;';
            } else if (assign) {
                bgStyle = 'background-color: #e3f2fd;';
            }

            html += `<td style="${bgStyle} padding: 2px;">`;
            html += `<select onchange="updateAssignment(${params.siteId}, '${dateStr}', ${u.id}, this.value)" style="width: 100%; ${cellStyle}">`;
            html += `<option value="">-</option>`;
            html += `<option value="OFF" ${currentShiftId === 'OFF' ? 'selected' : ''}>REQUEST OFF</option>`;
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
    display.innerHTML = html;
}

window.updateAssignment = async (siteId, date, userId, shiftId) => {
    // shiftId might be empty string if cleared
    try {
        await api.put('/api/schedule/assignment', { siteId, date, userId, shiftId });
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
    document.getElementById('snapshots-modal').style.display = 'flex';
    loadSnapshots();
};

window.loadSnapshots = async () => {
    const data = await api.get('/api/snapshots');
    const tbody = document.querySelector('#snapshots-table tbody');
    tbody.innerHTML = '';
    if(data.snapshots) {
        data.snapshots.forEach(s => {
            tbody.innerHTML += `
                <tr>
                    <td>${new Date(s.created_at).toLocaleString()}</td>
                    <td>${s.description}</td>
                    <td><button onclick="restoreSnapshot(${s.id})">Restore</button></td>
                </tr>
            `;
        });
    }
};

window.createSnapshot = async () => {
    const desc = document.getElementById('new-snapshot-desc').value;
    const res = await api.post('/api/snapshots', { description: desc });
    alert(res.message);
    loadSnapshots();
};

window.restoreSnapshot = async (id) => {
    if(confirm('Are you sure? This will overwrite the current database with this snapshot.')) {
        const res = await api.post(`/api/snapshots/${id}/restore`, {});
        alert(res.message);
        window.location.reload(); // Refresh to show restored state
    }
};

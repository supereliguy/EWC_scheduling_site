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

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await api.post('/api/logout');
        window.location.href = '/login.html';
    });
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
                    <button onclick="openSettings(${u.id})">Settings</button>
                    <button onclick="deleteUser(${u.id})">Delete</button>
                </td>
            </tr>
        `;
    });
}

window.openSettings = async (id) => {
    const data = await api.get(`/api/users/${id}/settings`);
    if(data.settings) {
        document.getElementById('settings-user-id').value = id;
        document.getElementById('setting-max-consecutive').value = data.settings.max_consecutive_shifts;
        document.getElementById('setting-min-days-off').value = data.settings.min_days_off;
        document.getElementById('setting-night-pref').value = data.settings.night_preference;
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
    const max_consecutive_shifts = parseInt(document.getElementById('setting-max-consecutive').value, 10);
    const min_days_off = parseInt(document.getElementById('setting-min-days-off').value, 10);
    const night_preference = parseFloat(document.getElementById('setting-night-pref').value);

    if (isNaN(max_consecutive_shifts) || max_consecutive_shifts < 1) {
        return alert('Max Consecutive Shifts must be a number >= 1');
    }
    if (isNaN(min_days_off) || min_days_off < 0) {
        return alert('Min Days Off must be a number >= 0');
    }
    if (isNaN(night_preference) || night_preference <= 0) {
        return alert('Night Preference must be a number > 0');
    }

    const res = await api.put(`/api/users/${id}/settings`, {
        max_consecutive_shifts,
        min_days_off,
        night_preference
    });

    alert(res.message);
    closeSettingsModal();
};

document.getElementById('create-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    if (username && password) {
        const res = await api.post('/api/users', { username, password, role });
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

document.getElementById('view-schedule-btn').addEventListener('click', loadSchedule);
document.getElementById('generate-schedule-btn').addEventListener('click', async () => {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    const res = await api.post('/api/schedule/generate', params);
    alert(res.message);
    loadSchedule();
});
document.getElementById('publish-schedule-btn').addEventListener('click', async () => {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    if(confirm('Publish schedule? Users will see it.')) {
        const res = await api.post('/api/schedule/publish', params);
        alert(res.message);
        loadSchedule();
    }
});
document.getElementById('export-csv-btn').addEventListener('click', () => {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    window.location.href = `/api/schedule/export/csv?siteId=${params.siteId}&month=${params.month}&year=${params.year}`;
});

async function loadSchedule() {
    const params = getScheduleParams();
    if(!params.siteId) return;
    const data = await api.get(`/api/schedule?siteId=${params.siteId}&month=${params.month}&year=${params.year}`);

    const display = document.getElementById('schedule-display');
    if (data.schedule && data.schedule.length > 0) {
        let html = '<table border="1"><tr><th>Date</th><th>Shift</th><th>User</th><th>Status</th></tr>';
        data.schedule.forEach(item => {
            html += `<tr><td>${item.date}</td><td>${item.shift_name}</td><td>${item.username}</td><td>${item.status}</td></tr>`;
        });
        html += '</table>';
        display.innerHTML = html;
    } else {
        display.innerHTML = '<p>No schedule found.</p>';
    }
}

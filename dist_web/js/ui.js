// UI Logic

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.initAppDB();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';

        // Load Initial Data
        await loadUsers();
        await loadSites();
        initDateSelectors();
    } catch(e) {
        document.getElementById('loading').innerHTML = '<div style="color:red">Error loading database: ' + e.message + '</div>';
        console.error(e);
    }
});

// Navigation
window.showSection = (id) => {
    document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
};

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

// --- Users ---
let users = [];

async function loadUsers() {
    const data = await window.App.getUsers();
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

document.getElementById('create-user-btn').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value;
    const role = document.getElementById('new-role').value;
    if (username) {
        const res = await window.App.createUser({ username, role });
        if (res.error) alert(res.error);
        else {
            alert('User created');
            document.getElementById('new-username').value = '';
            loadUsers();
        }
    }
});

window.deleteUser = async (id) => {
    if (confirm('Delete user?')) {
        await window.App.deleteUser(id);
        loadUsers();
    }
};

// --- Settings ---
window.openSettings = async (id) => {
    const data = await window.App.getUserSettings(id);
    if(data.settings) {
        const s = data.settings;
        document.getElementById('settings-user-id').value = id;
        document.getElementById('setting-max-consecutive').value = s.max_consecutive_shifts;
        document.getElementById('setting-min-days-off').value = s.min_days_off;
        document.getElementById('setting-night-pref').value = s.night_preference;
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
    const id = parseInt(document.getElementById('settings-user-id').value);
    const body = {
        max_consecutive_shifts: document.getElementById('setting-max-consecutive').value,
        min_days_off: document.getElementById('setting-min-days-off').value,
        night_preference: document.getElementById('setting-night-pref').value,
        target_shifts: document.getElementById('setting-target-shifts').value,
        target_shifts_variance: document.getElementById('setting-target-variance').value,
        preferred_block_size: document.getElementById('setting-block-size').value,
        shift_ranking: document.getElementById('setting-shift-ranking').value
    };

    const res = await window.App.updateUserSettings(id, body);
    alert(res.message);
    closeSettingsModal();
};

// --- Sites & Shifts ---
let sites = [];
let shifts = [];

async function loadSites() {
    const data = await window.App.getSites();
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
    const oldShiftVal = shiftSel.value;
    const oldSchedVal = schedSel.value;

    shiftSel.innerHTML = '<option value="">Select Site</option>';
    schedSel.innerHTML = '<option value="">Select Site</option>';
    sites.forEach(s => {
        shiftSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        schedSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });

    if(oldShiftVal) shiftSel.value = oldShiftVal;
    if(oldSchedVal) schedSel.value = oldSchedVal;
}

document.getElementById('create-site-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-site-name').value;
    const description = document.getElementById('new-site-desc').value;
    if (name) {
        await window.App.createSite({ name, description });
        document.getElementById('new-site-name').value = '';
        document.getElementById('new-site-desc').value = '';
        loadSites();
    }
});

window.deleteSite = async (id) => {
    if (confirm('Delete site?')) {
        await window.App.deleteSite(id);
        loadSites();
    }
};

window.loadShifts = async (siteId) => {
    document.getElementById('shift-site-select').value = siteId;
    const data = await window.App.getSiteShifts(siteId);
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
        await window.App.createShift(siteId, { name, start_time, end_time, required_staff });
        loadShifts(siteId);
    } else {
        alert('Select site and enter shift name');
    }
});

window.deleteShift = async (id) => {
    if (confirm('Delete shift?')) {
        await window.App.deleteShift(id);
        const siteId = document.getElementById('shift-site-select').value;
        if(siteId) loadShifts(siteId);
    }
};

// --- Schedule ---
const getScheduleParams = () => ({
    siteId: document.getElementById('schedule-site-select').value,
    year: parseInt(document.getElementById('schedule-year').value),
    month: parseInt(document.getElementById('schedule-month').value)
});

document.getElementById('load-schedule-btn').addEventListener('click', loadSchedule);

document.getElementById('generate-schedule-btn').addEventListener('click', async () => {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');

    // Create Snapshot before generating
    await window.App.createSnapshot({ description: `Auto-Backup before Generate ${params.year}-${params.month}` });

    try {
        await window.App.generateSchedule(params);
        alert('Schedule Generated!');
        loadSchedule();
    } catch(e) {
        alert('Error generating schedule: ' + e.message);
    }
});

async function loadSchedule() {
    const params = getScheduleParams();
    if(!params.siteId) return;

    const [scheduleData, shiftsData, usersData] = await Promise.all([
        window.App.getSchedule(params),
        window.App.getSiteShifts(params.siteId),
        window.App.getSiteUsers(params.siteId)
    ]);

    const assignments = scheduleData.schedule || [];
    const requests = scheduleData.requests || [];
    const shifts = shiftsData.shifts || [];
    const siteUsers = usersData.users || [];
    const daysInMonth = new Date(params.year, params.month, 0).getDate();

    const display = document.getElementById('schedule-display');

    let html = '<div style="overflow-x:auto;"><table border="1" style="min-width: 100%; text-align: center;">';
    html += '<thead><tr><th style="position: sticky; left: 0; background: #eee; z-index: 1;">User</th>';
    for(let d=1; d<=daysInMonth; d++) {
        const date = new Date(params.year, params.month-1, d);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        html += `<th style="min-width: 80px;">${d}<br><small>${dayName}</small></th>`;
    }
    html += '</tr></thead><tbody>';

    siteUsers.forEach(u => {
        html += `<tr><td style="position: sticky; left: 0; background: #fff; font-weight: bold;">${u.username}</td>`;
        for(let d=1; d<=daysInMonth; d++) {
            const dateStr = `${params.year}-${params.month.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
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
    display.innerHTML = html;
}

window.updateAssignment = async (siteId, date, userId, shiftId) => {
    try {
        await window.App.updateAssignment({ siteId, date, userId, shiftId });
    } catch(e) {
        alert('Error updating assignment: ' + e.message);
    }
};

// --- Snapshots ---
window.openSnapshotsModal = async () => {
    document.getElementById('snapshots-modal').style.display = 'flex';
    loadSnapshots();
};

async function loadSnapshots() {
    const data = await window.App.getSnapshots();
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
}

window.createSnapshot = async () => {
    const desc = document.getElementById('new-snapshot-desc').value || 'Manual Snapshot';
    const res = await window.App.createSnapshot({ description: desc });
    alert(res.message);
    loadSnapshots();
};

window.restoreSnapshot = async (id) => {
    if(confirm('Are you sure? This will overwrite the current database with this snapshot.')) {
        const res = await window.App.restoreSnapshot(id);
        alert(res.message);
        location.reload();
    }
};

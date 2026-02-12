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
        const tr = document.createElement('tr');

        // Secure: Uses textContent to prevent XSS
        const tdId = document.createElement('td');
        tdId.textContent = u.id;
        tr.appendChild(tdId);

        const tdName = document.createElement('td');
        tdName.textContent = u.username;
        tr.appendChild(tdName);

        const tdRole = document.createElement('td');
        tdRole.textContent = u.role;
        tr.appendChild(tdRole);

        const tdActions = document.createElement('td');

        const btnPref = document.createElement('button');
        btnPref.textContent = 'Preferences';
        btnPref.onclick = () => window.openSettings(u.id);
        tdActions.appendChild(btnPref);

        tdActions.appendChild(document.createTextNode(' '));

        const btnDel = document.createElement('button');
        btnDel.textContent = 'Delete';
        btnDel.onclick = () => window.deleteUser(u.id);
        tdActions.appendChild(btnDel);

        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
}

window.openSettings = async (id) => {
    try {
        const data = await apiClient.get(`/api/users/${id}/settings`);
        if(!data.settings) throw new Error('Could not load settings');
        const s = data.settings;

        document.getElementById('settings-user-id').value = id;
        document.getElementById('setting-max-consecutive').value = s.max_consecutive_shifts;
        document.getElementById('setting-min-days-off').value = s.min_days_off;
        document.getElementById('setting-target-shifts').value = s.target_shifts || 8;
        document.getElementById('setting-variance').value = s.target_shifts_variance || 2;
        document.getElementById('setting-block-size').value = s.preferred_block_size || 3;

        // Availability Rules
        let avail = { blocked_days: [], blocked_shifts: [] };
        try { avail = JSON.parse(s.availability_rules || '{"blocked_days":[], "blocked_shifts":[]}'); } catch(e) {}

        // Render Days (0=Sun)
        const daysDiv = document.getElementById('setting-avail-days');
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        daysDiv.innerHTML = '';

        // Define toggle function in scope or global
        window.toggleDayAvailability = (dayIndex, isChecked) => {
            // Update UI for shifts of this day
            const rows = document.querySelectorAll(`.shift-row-day-${dayIndex}`);
            rows.forEach(r => r.style.opacity = isChecked ? '1' : '0.5');

            const checks = document.querySelectorAll(`.day-shift-${dayIndex}`);
            checks.forEach(c => c.disabled = !isChecked);
        };

        window.toggleShiftColumn = (shiftId, isChecked) => {
            const inputs = document.querySelectorAll(`.avail-shift-check`);
            inputs.forEach(inp => {
                if (inp.value.startsWith(`${shiftId}-`) && !inp.disabled) {
                    inp.checked = isChecked;
                }
            });
        };

        // Helper for UI Toggling
        window.toggleShiftRanking = (isDisabled) => {
             const container = document.getElementById('shift-ranking-container');
             if (isDisabled) {
                 container.style.opacity = '0.5';
                 container.style.pointerEvents = 'none';
             } else {
                 container.style.opacity = '1';
                 container.style.pointerEvents = 'auto';
             }
        };

        dayNames.forEach((d, i) => {
            const isChecked = !avail.blocked_days.includes(i);
            daysDiv.innerHTML += `
                <div class="form-check">
                    <input class="form-check-input avail-day-check" type="checkbox" value="${i}" id="ad-${i}" ${isChecked ? 'checked' : ''} onchange="toggleDayAvailability(${i}, this.checked)">
                    <label class="form-check-label" for="ad-${i}">${d}</label>
                </div>
            `;
        });

        // Render Shifts (Fetch all sites first if needed)
        // We rely on adminSites being loaded. If empty, try load.
        if(adminSites.length === 0) await loadSites();

        const shiftsDiv = document.getElementById('setting-avail-shifts');
        const rankingContainer = document.getElementById('shift-ranking-container');

        shiftsDiv.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Loading shifts...';
        rankingContainer.innerHTML = '<div class="text-center p-3 text-muted">Loading...</div>';

        // Fetch shifts for all sites
        const allShifts = [];
        for (const site of adminSites) {
            const sData = await apiClient.get(`/api/sites/${site.id}/shifts`);
            if (sData.shifts) {
                sData.shifts.forEach(sh => {
                    sh.siteName = site.name;
                    allShifts.push(sh);
                });
            }
        }

        // --- 1. Render Shift Ranking ---
        let storedRanking = [];
        try { storedRanking = JSON.parse(s.shift_ranking || '[]'); } catch(e) {}

        // Setup No Preference Checkbox
        const noPrefCheck = document.getElementById('setting-no-preference');
        const isNoPref = !!s.no_preference;
        noPrefCheck.checked = isNoPref;
        toggleShiftRanking(isNoPref);

        // Sort shifts based on stored ranking (if IDs present)
        // If storedRanking has IDs, put them first in order. Unranked shifts go to bottom.
        let sortedShifts = [...allShifts];
        if (storedRanking.length > 0) {
            // Check if ranking uses IDs (numbers) or Names (strings - legacy)
            const isLegacy = typeof storedRanking[0] === 'string';

            if (!isLegacy) {
                 const rankMap = new Map();
                 storedRanking.forEach((id, idx) => rankMap.set(parseInt(id), idx));

                 sortedShifts.sort((a, b) => {
                     const rankA = rankMap.has(a.id) ? rankMap.get(a.id) : 9999;
                     const rankB = rankMap.has(b.id) ? rankMap.get(b.id) : 9999;
                     return rankA - rankB;
                 });
            }
        }

        rankingContainer.innerHTML = '';
        sortedShifts.forEach(sh => {
            const el = document.createElement('div');
            el.className = 'list-group-item list-group-item-action d-flex align-items-center gap-2';
            el.draggable = true;
            el.dataset.id = sh.id;
            el.innerHTML = `
                <span class="text-muted" style="cursor: grab;">☰</span>
                <div>
                    <strong>${escapeHTML(sh.siteName)}</strong>: ${escapeHTML(sh.name)}
                </div>
            `;

            // DnD Events
            el.addEventListener('dragstart', e => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', sh.id);
                el.classList.add('active');
                window.dragSrcEl = el;
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('active');
                window.dragSrcEl = null;
                document.querySelectorAll('#shift-ranking-container .list-group-item').forEach(i => i.classList.remove('border-primary', 'border-2'));
            });
            el.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                el.classList.add('border-primary', 'border-2');
            });
            el.addEventListener('dragleave', () => {
                el.classList.remove('border-primary', 'border-2');
            });
            el.addEventListener('drop', e => {
                e.preventDefault();
                el.classList.remove('border-primary', 'border-2');
                if (window.dragSrcEl !== el) {
                    // Reorder DOM
                    const list = rankingContainer;
                    // Simple swap or insert logic? Insert Before seems best.
                    // Determine if dropping above or below
                    const rect = el.getBoundingClientRect();
                    const offset = e.clientY - rect.top;
                    if (offset < (rect.height / 2)) {
                        list.insertBefore(window.dragSrcEl, el);
                    } else {
                        list.insertBefore(window.dragSrcEl, el.nextSibling);
                    }
                }
            });

            rankingContainer.appendChild(el);
        });


        // --- 2. Render Availability Grid ---
        shiftsDiv.innerHTML = '';
        if (allShifts.length === 0) {
            shiftsDiv.innerHTML = '<small class="text-muted">No shifts defined.</small>';
        } else {
            // Group by Site
            const bySite = {};
            allShifts.forEach(sh => {
                if (!bySite[sh.siteName]) bySite[sh.siteName] = [];
                bySite[sh.siteName].push(sh);
            });

            for (const [siteName, sList] of Object.entries(bySite)) {
                shiftsDiv.innerHTML += `<h6 class="mt-3 mb-2 text-primary fw-bold border-bottom pb-1">${escapeHTML(siteName)}</h6>`;

                // Render Column Toggles
                let togglesHtml = `<div class="mb-2 ms-2 p-2 border rounded bg-light">
                    <small class="fw-bold text-secondary d-block mb-1">Quick Toggles (Enabled Days Only):</small>
                    <div class="d-flex flex-wrap gap-3">`;

                sList.forEach(sh => {
                    let isAllChecked = true;
                    const activeDays = (sh.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);

                    // Check active days that are not globally blocked
                    for (const dIndex of activeDays) {
                         if (avail.blocked_days.includes(dIndex)) continue; // Day is disabled, ignore

                         const key = `${sh.id}-${dIndex}`;
                         if (avail.blocked_shift_days) {
                              if (avail.blocked_shift_days.includes(key)) isAllChecked = false;
                         } else if (avail.blocked_shifts) {
                              if (avail.blocked_shifts.includes(sh.id)) isAllChecked = false;
                         }
                         if (!isAllChecked) break;
                    }

                    togglesHtml += `
                        <div class="form-check form-check-inline m-0">
                            <input class="form-check-input" type="checkbox"
                                   onchange="toggleShiftColumn('${sh.id}', this.checked)"
                                   ${isAllChecked ? 'checked' : ''}>
                            <label class="form-check-label small fw-bold">${escapeHTML(sh.name)}</label>
                        </div>`;
                });
                togglesHtml += `</div></div>`;
                shiftsDiv.innerHTML += togglesHtml;

                // Render rows for each day 0-6
                dayNames.forEach((dName, dayIndex) => {
                    // Find shifts active on this day
                    const dayShifts = sList.filter(sh => {
                         const activeDays = (sh.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
                         return activeDays.includes(dayIndex);
                    });

                    if (dayShifts.length > 0) {
                        const isDayAllowed = !avail.blocked_days.includes(dayIndex);
                        const rowStyle = isDayAllowed ? '' : 'opacity: 0.5;';

                        let rowHtml = `<div class="mb-1 ms-2 d-flex align-items-center shift-row-day-${dayIndex}" style="${rowStyle}">
                            <strong class="small me-2 text-secondary" style="width: 80px;">${dName}:</strong>
                            <div class="d-flex flex-wrap gap-2">`;

                        dayShifts.forEach(sh => {
                            let isChecked = true;
                            const key = `${sh.id}-${dayIndex}`;

                            if (avail.blocked_shift_days) {
                                if (avail.blocked_shift_days.includes(key)) isChecked = false;
                            } else if (avail.blocked_shifts) {
                                // Fallback: if blocked globally, uncheck everywhere
                                if (avail.blocked_shifts.includes(sh.id)) isChecked = false;
                            }

                            const disabled = isDayAllowed ? '' : 'disabled';

                            rowHtml += `
                                <div class="form-check form-check-inline m-0">
                                    <input class="form-check-input avail-shift-check day-shift-${dayIndex}" type="checkbox" value="${key}" id="as-${key}" ${isChecked ? 'checked' : ''} ${disabled}>
                                    <label class="form-check-label small" for="as-${key}">${escapeHTML(sh.name)}</label>
                                </div>
                            `;
                        });
                        rowHtml += `</div></div>`;
                        shiftsDiv.innerHTML += rowHtml;
                    }
                });
            }
        }

        // Bootstrap Modal
        const modal = new bootstrap.Modal(document.getElementById('settingsModal'));
        modal.show();
    } catch(e) {
        console.error(e);
        alert('Error loading settings: ' + e.message);
    }
};

window.saveSettings = async () => {
    const id = document.getElementById('settings-user-id').value;

    // Parse shift ranking (New)
    const rankingContainer = document.getElementById('shift-ranking-container');
    const ranking = [];
    rankingContainer.querySelectorAll('.list-group-item').forEach(el => {
        ranking.push(parseInt(el.dataset.id));
    });

    const noPreference = document.getElementById('setting-no-preference').checked;

    // Parse Availability
    const blocked_days = [];
    document.querySelectorAll('.avail-day-check:not(:checked)').forEach(el => blocked_days.push(parseInt(el.value)));

    const blocked_shift_days = [];
    // Collect unchecked shift-day boxes. Their value is "shiftId-dayIndex"
    document.querySelectorAll('.avail-shift-check:not(:checked)').forEach(el => blocked_shift_days.push(el.value));

    // Clear blocked_shifts (old format) as we migrated to blocked_shift_days
    const availability_rules = { blocked_days, blocked_shift_days, blocked_shifts: [] };

    const body = {
        max_consecutive_shifts: document.getElementById('setting-max-consecutive').value,
        min_days_off: document.getElementById('setting-min-days-off').value,
        target_shifts: document.getElementById('setting-target-shifts').value,
        night_preference: 1.0,
        target_shifts_variance: document.getElementById('setting-variance').value,
        preferred_block_size: document.getElementById('setting-block-size').value,
        shift_ranking: JSON.stringify(ranking),
        availability_rules: JSON.stringify(availability_rules),
        no_preference: noPreference
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
        document.getElementById('gs-max-consecutive').value = s.max_consecutive_shifts || 5;
        document.getElementById('gs-min-days-off').value = s.min_days_off || 2;
        document.getElementById('gs-target-shifts').value = s.target_shifts || 20;
        document.getElementById('gs-variance').value = s.target_shifts_variance || 2;
        document.getElementById('gs-block-size').value = s.preferred_block_size || 3;
        document.getElementById('gs-min-consecutive-nights').value = s.min_consecutive_nights || 2;

        // Weights
        document.getElementById('rw-availability').value = s.rule_weight_availability || 10;
        document.getElementById('rw-request-off').value = s.rule_weight_request_off || 10;
        document.getElementById('rw-max-consecutive').value = s.rule_weight_max_consecutive || 10;
        document.getElementById('rw-min-days-off').value = s.rule_weight_min_days_off || 10;
        document.getElementById('rw-target-variance').value = s.rule_weight_target_variance || 10;
        document.getElementById('rw-circadian-strict').value = s.rule_weight_circadian_strict || 10;
        document.getElementById('rw-circadian-soft').value = s.rule_weight_circadian_soft || 5;
        document.getElementById('rw-min-consecutive-nights').value = s.rule_weight_min_consecutive_nights || 5;
        document.getElementById('rw-block-size').value = s.rule_weight_block_size || 5;
        document.getElementById('rw-weekend-fairness').value = s.rule_weight_weekend_fairness || 5;
        document.getElementById('rw-request-work-specific').value = s.rule_weight_request_work_specific || 10;
        document.getElementById('rw-request-avoid-shift').value = s.rule_weight_request_avoid_shift || 10;
        document.getElementById('rw-request-work').value = s.rule_weight_request_work || 10;
    }
};

window.saveGlobalSettings = async () => {
    const body = {
        max_consecutive_shifts: document.getElementById('gs-max-consecutive').value,
        min_days_off: document.getElementById('gs-min-days-off').value,
        target_shifts: document.getElementById('gs-target-shifts').value,
        target_shifts_variance: document.getElementById('gs-variance').value,
        preferred_block_size: document.getElementById('gs-block-size').value,
        min_consecutive_nights: document.getElementById('gs-min-consecutive-nights').value,
        night_preference: 1.0,

        // Weights
        rule_weight_availability: document.getElementById('rw-availability').value,
        rule_weight_request_off: document.getElementById('rw-request-off').value,
        rule_weight_max_consecutive: document.getElementById('rw-max-consecutive').value,
        rule_weight_min_days_off: document.getElementById('rw-min-days-off').value,
        rule_weight_target_variance: document.getElementById('rw-target-variance').value,
        rule_weight_circadian_strict: document.getElementById('rw-circadian-strict').value,
        rule_weight_circadian_soft: document.getElementById('rw-circadian-soft').value,
        rule_weight_min_consecutive_nights: document.getElementById('rw-min-consecutive-nights').value,
        rule_weight_block_size: document.getElementById('rw-block-size').value,
        rule_weight_weekend_fairness: document.getElementById('rw-weekend-fairness').value,
        rule_weight_request_work_specific: document.getElementById('rw-request-work-specific').value,
        rule_weight_request_avoid_shift: document.getElementById('rw-request-avoid-shift').value,
        rule_weight_request_work: document.getElementById('rw-request-work').value
    };

    try {
        const res = await apiClient.put('/api/settings/global', body);
        alert(res.message);
    } catch(e) { alert(e.message); }
};

// --- User Requests Calendar Logic ---
let reqCalendarWidget = null;
let currentReqUserId = null;

window.openRequestsModal = async () => {
    const userId = document.getElementById('settings-user-id').value;
    const user = users.find(u => u.id == userId);
    if (!user) return;

    currentReqUserId = userId;
    document.getElementById('req-modal-username').textContent = user.username;

    // Default to current month
    const today = new Date();
    document.getElementById('req-calendar-month').value = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2, '0')}`;

    // Load User Sites
    const sitesData = await apiClient.get(`/api/users/${userId}/sites`);
    const sites = sitesData.sites || [];
    const select = document.getElementById('req-site-select');
    select.innerHTML = '';

    if (sites.length === 0) {
        alert('This user is not assigned to any sites. Please assign them to a site first.');
        return;
    }

    sites.forEach(s => {
        select.innerHTML += `<option value="${s.id}">${escapeHTML(s.name)}</option>`;
    });

    // Initialize Widget if needed
    if (!reqCalendarWidget) {
        reqCalendarWidget = new window.CalendarWidget('req-calendar-container', {
            onPaint: (date, type) => { /* Auto-updates internal state of widget */ }
        });

        // Bind select change
        document.getElementById('req-shift-select').addEventListener('change', window.updateReqWidgetState);
    }

    // Default mode
    window.setReqMode('work');

    // Load shifts for initial site to populate dropdown
    await populateReqShifts(select.value);

    updateReqCalendar();

    const modal = new bootstrap.Modal(document.getElementById('requestsModal'));
    modal.show();
};

let currentReqShifts = [];

window.setReqMode = (mode) => {
    // UI Update
    ['work', 'avoid', 'off', 'clear'].forEach(m => {
        const btn = document.getElementById(`req-${m}-btn`);
        if(btn) btn.classList.remove('active', 'btn-success', 'btn-warning', 'btn-danger', 'btn-secondary');
    });

    const btn = document.getElementById(`req-${mode}-btn`);
    if(btn) {
        btn.classList.add('active');
        if(mode === 'work') btn.classList.add('btn-success');
        else if(mode === 'avoid') btn.classList.add('btn-warning');
        else if(mode === 'off') btn.classList.add('btn-danger');
        else btn.classList.add('btn-secondary');
    }

    const shiftSelect = document.getElementById('req-shift-select');
    shiftSelect.disabled = (mode !== 'work' && mode !== 'avoid');

    window.updateReqWidgetState();
};

window.updateReqWidgetState = () => {
    const activeBtn = document.querySelector('#requestsModal .btn-group .active');
    if (!activeBtn) return;
    const mode = activeBtn.id.replace('req-', '').replace('-btn', '');

    const shiftSelect = document.getElementById('req-shift-select');
    const shiftId = (mode === 'work' || mode === 'avoid') && shiftSelect.value ? parseInt(shiftSelect.value) : null;
    let shiftName = null;
    if (shiftId) shiftName = shiftSelect.options[shiftSelect.selectedIndex].text;

    if(reqCalendarWidget) {
        reqCalendarWidget.setPaintMode(mode, shiftId, shiftName);
    }
};

window.populateReqShifts = async (siteId) => {
    const shiftSelect = document.getElementById('req-shift-select');
    shiftSelect.innerHTML = '<option value="">Any Shift</option>';
    currentReqShifts = [];
    if(!siteId) return;

    try {
        const data = await apiClient.get(`/api/sites/${siteId}/shifts`);
        if(data.shifts) {
            currentReqShifts = data.shifts;
            data.shifts.forEach(s => {
                shiftSelect.innerHTML += `<option value="${s.id}">${escapeHTML(s.name)}</option>`;
            });
        }
    } catch(e) { console.error(e); }
};

// Hook into site select change to update shifts
document.getElementById('req-site-select').addEventListener('change', async function() {
    await populateReqShifts(this.value);
    updateReqCalendar();
});


window.updateReqCalendar = async () => {
    if (!currentReqUserId) return;

    const monthVal = document.getElementById('req-calendar-month').value;
    const siteId = document.getElementById('req-site-select').value;

    if (!monthVal || !siteId) return;

    const [year, month] = monthVal.split('-').map(Number);

    const reqData = await apiClient.get(`/api/requests?siteId=${siteId}&month=${month}&year=${year}`);
    // Filter for this user (api returns all for site/month)
    // Map DB fields to Widget fields
    const userRequests = (reqData.requests || [])
        .filter(r => r.user_id == currentReqUserId)
        .map(r => {
            const shiftId = r.shift_id;
            const shift = currentReqShifts.find(s => s.id === shiftId);
            return {
                date: r.date,
                type: r.type,
                shiftId: shiftId,
                shiftName: shift ? shift.name : null
            };
        });

    reqCalendarWidget.setMonth(year, month);
    reqCalendarWidget.setData(userRequests);
};

window.saveUserRequests = async () => {
    if (!currentReqUserId) return;
    const monthVal = document.getElementById('req-calendar-month').value;
    const [year, month] = monthVal.split('-').map(Number);
    const siteId = document.getElementById('req-site-select').value;

    if(!siteId) return;

    const requests = reqCalendarWidget.requests;

    try {
        await apiClient.post('/api/requests', {
            siteId,
            requests,
            month,
            year,
            userId: currentReqUserId
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
        const tr = document.createElement('tr');

        const tdId = document.createElement('td');
        tdId.textContent = s.id;
        tr.appendChild(tdId);

        const tdName = document.createElement('td');
        const aName = document.createElement('a');
        aName.href = '#';
        aName.onclick = (e) => { e.preventDefault(); enterSite(s.id); };
        aName.className = 'fs-5 fw-bold text-decoration-none';
        aName.textContent = s.name;
        tdName.appendChild(aName);
        tr.appendChild(tdName);

        const tdActions = document.createElement('td');

        const btnEnter = document.createElement('button');
        btnEnter.className = 'btn btn-success fw-bold px-3';
        btnEnter.onclick = () => enterSite(s.id);
        btnEnter.textContent = 'Enter Dashboard';
        tdActions.appendChild(btnEnter);

        const btnUsers = document.createElement('button');
        btnUsers.className = 'btn btn-sm btn-secondary ms-2';
        btnUsers.onclick = () => openSiteUsersModal(s.id);
        btnUsers.textContent = 'Users';
        tdActions.appendChild(btnUsers);

        const btnShifts = document.createElement('button');
        btnShifts.className = 'btn btn-sm btn-info ms-1';
        btnShifts.onclick = () => loadShifts(s.id);
        btnShifts.textContent = 'Shifts';
        tdActions.appendChild(btnShifts);

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-sm btn-danger ms-1';
        btnDelete.onclick = () => deleteSite(s.id);
        btnDelete.textContent = 'Delete';
        tdActions.appendChild(btnDelete);

        tr.appendChild(tdActions);
        tbody.appendChild(tr);
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
                    ${escapeHTML(u.username)} (${escapeHTML(u.role)})
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
let currentScheduleView = 'dates-shifts'; // 'timeline' or 'calendar'

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

window.enterSite = async (siteId) => {
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

    // Populate Settings
    document.getElementById('site-weekend-start-day').value = site.weekend_start_day !== undefined ? site.weekend_start_day : 5;
    document.getElementById('site-weekend-start-time').value = site.weekend_start_time || '21:00';
    document.getElementById('site-weekend-end-day').value = site.weekend_end_day !== undefined ? site.weekend_end_day : 0;
    document.getElementById('site-weekend-end-time').value = site.weekend_end_time || '16:00';

    loadSchedule();
};

window.saveSiteSettings = async () => {
    const siteId = document.getElementById('site-dashboard-section').dataset.siteId;
    const body = {
        weekend_start_day: parseInt(document.getElementById('site-weekend-start-day').value),
        weekend_start_time: document.getElementById('site-weekend-start-time').value,
        weekend_end_day: parseInt(document.getElementById('site-weekend-end-day').value),
        weekend_end_time: document.getElementById('site-weekend-end-time').value
    };

    try {
        await apiClient.put(`/api/sites/${siteId}`, body);
        alert('Settings saved. Please regenerate stats/schedule to apply changes.');
        // Update local adminSites
        const site = adminSites.find(s => s.id == siteId);
        if (site) Object.assign(site, body);
        loadSchedule(); // Refresh stats
    } catch(e) {
        alert(e.message);
    }
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

    const updateBtn = (id, active) => {
        const btn = document.getElementById(id);
        if(!btn) return;
        btn.classList.toggle('active', active);
        btn.classList.toggle('btn-primary', active);
        btn.classList.toggle('btn-outline-primary', !active);
    };

    updateBtn('view-timeline-btn', mode === 'timeline');
    updateBtn('view-calendar-btn', mode === 'calendar');
    updateBtn('view-dates-shifts-btn', mode === 'dates-shifts');
    updateBtn('view-shifts-dates-btn', mode === 'shifts-dates');

    loadSchedule();
};

function updateSiteSelects() {
    const shiftSel = document.getElementById('shift-site-select');
    if(shiftSel) {
        shiftSel.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Select Site';
        shiftSel.appendChild(defaultOpt);

        adminSites.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            shiftSel.appendChild(opt);
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
    const dNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    shifts.forEach(s => {
        const tr = document.createElement('tr');

        const days = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
        let dayStr = 'All Days';
        if (days.length < 7) {
            dayStr = days.map(d => dNames[d]).join(', ');
        }

        const tdName = document.createElement('td');
        const nameSpan = document.createElement('span');
        nameSpan.textContent = s.name;
        tdName.appendChild(nameSpan);
        tdName.appendChild(document.createElement('br'));
        const daySmall = document.createElement('small');
        daySmall.className = 'text-secondary';
        daySmall.textContent = dayStr;
        tdName.appendChild(daySmall);
        tr.appendChild(tdName);

        const tdTime = document.createElement('td');
        tdTime.textContent = `${s.start_time} - ${s.end_time}`;
        tr.appendChild(tdTime);

        const tdStaff = document.createElement('td');
        tdStaff.textContent = s.required_staff;
        tr.appendChild(tdStaff);

        const tdActions = document.createElement('td');
        const btnDel = document.createElement('button');
        btnDel.className = 'btn btn-sm btn-danger';
        btnDel.textContent = 'Delete';
        btnDel.onclick = () => window.deleteShift(s.id);
        tdActions.appendChild(btnDel);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

document.getElementById('create-shift-btn').addEventListener('click', async () => {
    const siteId = document.getElementById('shift-site-select').value;
    const name = document.getElementById('new-shift-name').value;
    const start_time = document.getElementById('new-shift-start').value;
    const end_time = document.getElementById('new-shift-end').value;
    let required_staff = document.getElementById('new-shift-staff').value;
    if (!required_staff) required_staff = 1;

    const days_of_week = Array.from(document.querySelectorAll('.shift-day-check:checked')).map(c => c.value).join(',');

    if (siteId && name) {
        try {
            await apiClient.post(`/api/sites/${siteId}/shifts`, { name, start_time, end_time, required_staff, days_of_week });
            loadShifts(siteId);
        } catch (e) {
            console.error("Error creating shift:", e);
            alert("Failed to create shift: " + e.message);
        }
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

document.getElementById('generate-schedule-btn').addEventListener('click', () => runScheduleGeneration(true));

// Legacy Force Handler (can be removed if modal is never shown)
window.forceGenerateSchedule = () => {
    // Hide modal
    const modalEl = document.getElementById('conflictModal');
    if(modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if(modal) modal.hide();
    }
    runScheduleGeneration(true);
};

async function runScheduleGeneration(force) {
    const params = getScheduleParams();
    if(!params.siteId) return alert('Select site');
    if(!params.startDate) return alert('Select start date');

    // Always Force by default for new workflow
    params.force = true;

    const iterInput = document.getElementById('schedule-iterations');
    params.iterations = iterInput ? iterInput.value : 100;

    const statusEl = document.getElementById('generation-status');
    const progressBar = document.getElementById('generation-progress-bar');
    const btn = document.getElementById('generate-schedule-btn');

    statusEl.classList.remove('d-none');
    statusEl.classList.add('d-flex');
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.classList.remove('bg-success');
        progressBar.classList.add('bg-info');
    }

    btn.disabled = true;

    await new Promise(r => setTimeout(r, 100));

    // Callback for progress
    const onProgress = (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
    };
    params.onProgress = onProgress;

    try {
        const res = await apiClient.post('/api/schedule/generate', params);

        if(progressBar) {
             progressBar.style.width = '100%';
             progressBar.classList.remove('bg-info');
             progressBar.classList.add('bg-success');
        }

        setTimeout(() => {
             statusEl.classList.add('d-none');
             statusEl.classList.remove('d-flex');
        }, 2000);

        loadSchedule();

    } catch (e) {
        alert(e.message);
        statusEl.classList.add('d-none');
        statusEl.classList.remove('d-flex');
    } finally {
        btn.disabled = false;
    }
}

function renderConflictReport(report) {
    const container = document.getElementById('conflict-report-list');
    container.innerHTML = '';

    report.forEach(item => {
        let html = `<div class="card mb-2"><div class="card-body py-2">
            <h6 class="card-title text-danger">${escapeHTML(item.date)} - ${escapeHTML(item.shiftName)}</h6>`;

        if (item.failures) {
            html += `<ul class="small mb-0 text-secondary">`;
            item.failures.forEach(f => {
                html += `<li><strong>${escapeHTML(f.username)}:</strong> ${escapeHTML(f.reason)}</li>`;
            });
            html += `</ul>`;
        } else if (item.reason) {
            html += `<p class="mb-0 text-danger small">${escapeHTML(item.reason)} ${item.username ? '('+escapeHTML(item.username)+')' : ''}</p>`;
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
    } else if (currentScheduleView === 'dates-shifts') {
        renderScheduleDatesShiftsView(display, params, assignments, requests, shifts, siteUsers);
    } else if (currentScheduleView === 'shifts-dates') {
        renderScheduleShiftsDatesView(display, params, assignments, requests, shifts, siteUsers);
    } else {
        renderScheduleTimelineView(display, params, assignments, requests, shifts, siteUsers);
    }

    // Update Other Tabs
    renderSiteUsersList(siteUsers);
    renderStats(siteUsers, assignments, shifts);

    // Update Health Panel
    analyzeScheduleHealth(assignments, siteUsers, params);
}

function analyzeScheduleHealth(assignments, users, params) {
    if (!window.validateSchedule) return;

    try {
        const report = window.validateSchedule({
            siteId: parseInt(params.siteId),
            startDate: params.startDate,
            days: parseInt(params.days),
            assignments: assignments
        });
        renderHealthPanel(report, users);
    } catch (e) {
        console.error("Health Check Failed:", e);
    }
}

function renderHealthPanel(report, users) {
    const container = document.getElementById('schedule-health-panel');
    if (!container) return;

    container.innerHTML = '';

    // Create Flex Container
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex flex-wrap gap-2 p-2 border rounded bg-white shadow-sm align-items-center';

    wrapper.innerHTML = '<span class="fw-bold text-secondary me-2 small">Health:</span>';

    // Sort users: Error first, then Warning, then OK
    const sortedUsers = [...users].sort((a, b) => {
        const sa = report[a.id]?.status || 'ok';
        const sb = report[b.id]?.status || 'ok';
        const scores = { error: 0, warning: 1, ok: 2 };
        if (scores[sa] !== scores[sb]) return scores[sa] - scores[sb];
        return a.username.localeCompare(b.username);
    });

    sortedUsers.forEach(u => {
        const r = report[u.id] || { status: 'ok', issues: [] };

        const badge = document.createElement('div');
        badge.className = 'badge d-flex align-items-center gap-1';
        badge.style.cursor = 'help';
        badge.style.color = '#000';
        badge.style.border = '1px solid #ddd';

        let icon = '✅';
        let bg = '#e6fffa'; // Light Green
        let tooltipText = 'All Constraints Met';

        if (r.status === 'error') {
            icon = '❌';
            bg = '#ffe6e6'; // Light Red
            tooltipText = r.issues.map(i => `${i.date}: ${i.reason} (${i.shift})`).join('\n');
        } else if (r.status === 'warning') {
            icon = '⚠️'; // Yellow Exclamation
            bg = '#fffbe6'; // Light Yellow
            tooltipText = r.issues.map(i => `${i.date}: ${i.reason} (${i.shift})`).join('\n');
        }

        badge.style.backgroundColor = bg;
        badge.innerHTML = `<span style="font-size: 1.1em;">${icon}</span> <span>${escapeHTML(u.username)}</span>`;
        badge.title = tooltipText;

        // Initialize Bootstrap Tooltip
        new bootstrap.Tooltip(badge);

        wrapper.appendChild(badge);
    });

    container.appendChild(wrapper);
    container.classList.remove('d-none');
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
        html += `<tr><td style="position: sticky; left: 0; background: #161b22; z-index: 10; font-weight: bold; border-right: 2px solid #30363d;">${escapeHTML(u.username)}</td>`;
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
            let cellClass = 'schedule-cell';

            if (isLocked) cellClass += ' schedule-cell-locked';
            else if (isOff) cellClass += ' schedule-cell-off';
            else if (assign) cellClass += ' schedule-cell-assigned';

            html += `<td class="${cellClass}">`;
            html += `<div class="d-flex align-items-center gap-1 justify-content-center">`;
            html += `<select class="form-select form-select-sm" style="min-width: 80px;" onchange="updateAssignment(${params.siteId}, '${dateStr}', ${u.id}, this.value)">`;
            html += `<option value="">-</option>`;
            html += `<option value="OFF" ${currentShiftId === 'OFF' ? 'selected' : ''}>OFF</option>`;
            shifts.forEach(s => {
                const validDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
                if (!validDays.includes(date.getDay())) return;
                const selected = currentShiftId === s.id ? 'selected' : '';
                html += `<option value="${s.id}" ${selected}>${escapeHTML(s.name)}</option>`;
            });
            html += `</select>`;

            if (currentShiftId && currentShiftId !== 'OFF') {
                 const icon = isLocked ? '🔒' : '🔓';
                 const color = isLocked ? 'text-danger' : 'text-secondary';
                 html += `<span class="${color}" style="cursor: pointer; font-size: 1.1rem;" onclick="toggleAssignmentLock(${params.siteId}, '${dateStr}', ${u.id}, '${currentShiftId}', ${isLocked})">${icon}</span>`;
            }
            html += `</div></td>`;
        }
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function renderScheduleDatesShiftsView(container, params, assignments, requests, shifts, users) {
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m-1, d);
    const daysCount = parseInt(params.days);

    let html = '<div style="overflow-x:auto;"><table class="table table-bordered mb-0" style="min-width: 100%; text-align: center;">';

    // Header: Date, Shift 1, Shift 2...
    html += '<thead><tr><th style="min-width: 120px;">Date</th>';
    shifts.forEach(s => {
        html += `<th>${escapeHTML(s.name)} <small class="text-secondary d-block">Req: ${s.required_staff}</small></th>`;
    });
    html += '</tr></thead><tbody>';

    // Rows: Dates
    for(let i=0; i<daysCount; i++) {
        const date = new Date(startObj);
        date.setDate(startObj.getDate() + i);
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });

        html += `<tr><td class="fw-bold">${date.getMonth()+1}/${date.getDate()} <small>${dayName}</small></td>`;

        shifts.forEach(s => {
            // Find assignments for this shift on this date
            const shiftAssigns = assignments.filter(a => a.date === dateStr && a.shift_id === s.id);

            html += '<td style="min-width: 200px;">';

            const validDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
            if (!validDays.includes(date.getDay())) {
                html += '<small class="text-secondary">N/A</small></td>';
                return;
            }

            // Render existing assignments as dropdowns
            // Plus empty slots if needed to reach required_staff
            const slots = Math.max(s.required_staff, shiftAssigns.length);

            // Collect used users for this day (to grey out?) - Logic simplified for now

            for(let k=0; k<slots; k++) {
                const assign = shiftAssigns[k]; // undefined if empty slot
                const currentUserId = assign ? assign.user_id : '';
                const isLocked = assign ? assign.is_locked : false;

                html += `<div class="d-flex align-items-center gap-1 mb-1">`;
                html += `<select class="form-select form-select-sm" onchange="updateShiftSlot(${params.siteId}, '${dateStr}', ${s.id}, this.value, '${currentUserId}')">`;
                html += `<option value="">-</option>`;
                users.forEach(u => {
                    const selected = u.id === currentUserId ? 'selected' : '';
                    html += `<option value="${u.id}" ${selected}>${escapeHTML(u.username)}</option>`;
                });
                html += `</select>`;

                if (assign) {
                     const icon = isLocked ? '🔒' : '🔓';
                     const color = isLocked ? 'text-danger' : 'text-secondary';
                     html += `<span class="${color}" style="cursor: pointer;" onclick="toggleAssignmentLock(${params.siteId}, '${dateStr}', ${currentUserId}, '${s.id}', ${isLocked})">${icon}</span>`;
                }
                html += `</div>`;
            }
            html += '</td>';
        });
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function renderScheduleShiftsDatesView(container, params, assignments, requests, shifts, users) {
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m-1, d);
    const daysCount = parseInt(params.days);

    let html = '<div style="overflow-x:auto;"><table class="table table-bordered mb-0" style="min-width: 100%; text-align: center;">';

    // Header: Shift, Date 1, Date 2...
    html += '<thead><tr><th style="min-width: 150px; left: 0; z-index: 20; position: sticky;">Shift</th>';
    for(let i=0; i<daysCount; i++) {
        const date = new Date(startObj);
        date.setDate(startObj.getDate() + i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        html += `<th style="min-width: 150px;">${date.getMonth()+1}/${date.getDate()}<br><small class="text-secondary">${dayName}</small></th>`;
    }
    html += '</tr></thead><tbody>';

    // Rows: Shifts
    shifts.forEach(s => {
        html += `<tr><td style="position: sticky; left: 0; background: #161b22; z-index: 10; font-weight: bold; border-right: 2px solid #30363d;">${escapeHTML(s.name)} <br><small class="text-secondary">Req: ${s.required_staff}</small></td>`;

        for(let i=0; i<daysCount; i++) {
            const date = new Date(startObj);
            date.setDate(startObj.getDate() + i);
            const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;

            const shiftAssigns = assignments.filter(a => a.date === dateStr && a.shift_id === s.id);

            html += '<td>';

            const validDays = (s.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
            if (!validDays.includes(date.getDay())) {
                html += '<small class="text-secondary">N/A</small></td>';
                continue;
            }

            const slots = Math.max(s.required_staff, shiftAssigns.length);

            for(let k=0; k<slots; k++) {
                const assign = shiftAssigns[k];
                const currentUserId = assign ? assign.user_id : '';
                const isLocked = assign ? assign.is_locked : false;

                html += `<div class="d-flex align-items-center gap-1 mb-1">`;
                html += `<select class="form-select form-select-sm" onchange="updateShiftSlot(${params.siteId}, '${dateStr}', ${s.id}, this.value, '${currentUserId}')">`;
                html += `<option value="">-</option>`;
                users.forEach(u => {
                    const selected = u.id === currentUserId ? 'selected' : '';
                    html += `<option value="${u.id}" ${selected}>${escapeHTML(u.username)}</option>`;
                });
                html += `</select>`;

                if (assign) {
                     const icon = isLocked ? '🔒' : '🔓';
                     const color = isLocked ? 'text-danger' : 'text-secondary';
                     html += `<span class="${color}" style="cursor: pointer;" onclick="toggleAssignmentLock(${params.siteId}, '${dateStr}', ${currentUserId}, '${s.id}', ${isLocked})">${icon}</span>`;
                }
                html += `</div>`;
            }
            html += '</td>';
        }
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

window.updateShiftSlot = async (siteId, date, shiftId, newUserId, oldUserId) => {
    // 1. If old user existed, clear them (set shiftId='')
    // 2. If new user selected, assign them (set shiftId=shiftId)
    // Note: API clears existing assignment for user on date automatically.

    try {
        if (oldUserId && oldUserId !== 'undefined') {
            // Unassign old user from this shift
            // We set their shift to empty string (which clears assignment)
            await apiClient.put('/api/schedule/assignment', { siteId, date, userId: oldUserId, shiftId: '' });
        }

        if (newUserId) {
            // Assign new user to this shift
            await apiClient.put('/api/schedule/assignment', { siteId, date, userId: newUserId, shiftId });
        }

        // Reload to refresh view and slots
        loadSchedule();
    } catch(e) {
        alert('Error updating slot: ' + e.message);
    }
};

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

    // Pre-group assignments by date for O(1) access
    const assignmentsByDate = {};
    assignments.forEach(a => {
        if (!assignmentsByDate[a.date]) assignmentsByDate[a.date] = [];
        assignmentsByDate[a.date].push(a);
    });

    // Create user map for O(1) lookup
    const userMap = new Map();
    users.forEach(u => userMap.set(u.id, u.username));

    // Days
    for(let i=0; i<daysCount; i++) {
        const date = new Date(startObj);
        date.setDate(startObj.getDate() + i);
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;

        // Find all assignments for this day (O(1))
        const dayAssigns = assignmentsByDate[dateStr] || [];

        // Group by Shift
        const shiftsOnDay = {};
        shifts.forEach(s => shiftsOnDay[s.id] = []);

        dayAssigns.forEach(a => {
            if(shiftsOnDay[a.shift_id]) {
                const username = userMap.get(a.user_id);
                if(username) shiftsOnDay[a.shift_id].push(username);
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
                const userList = assignedUsers.map(u => escapeHTML(u)).join(', ');
                html += `<div class="${badgeClass}" title="${escapeHTML(s.name)}: ${userList}">
                    <strong>${escapeHTML(s.name)}:</strong> ${userList}
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
                <td>${escapeHTML(u.username)}</td>
                <td>${escapeHTML(u.role)}</td>
                <td>
                    <select class="form-select form-select-sm" onchange="updateUserCategory(${u.id}, this.value)">
                        <option value="">None</option>
                        ${categories.map(c => `<option value="${c.id}" ${u.category_id === c.id ? 'selected' : ''}>${escapeHTML(c.name)}</option>`).join('')}
                    </select>
                </td>
            </tr>`).join('')}
    </tbody></table>`;
}

function renderStats(users, assignments, shifts) {
    const container = document.getElementById('site-stats-display');

    let html = `<div class="table-responsive"><table class="table table-bordered table-hover text-nowrap"><thead><tr>
        <th>User</th><th>Total Shifts</th><th>Total Hours</th><th>Weekends</th><th>Nights</th>`;

    // Dynamic Headers for Shifts
    shifts.forEach(s => {
        html += `<th>${escapeHTML(s.name)}</th>`;
    });

    html += `</tr></thead><tbody>`;

    users.forEach(u => {
        const myAssigns = assignments.filter(a => a.user_id === u.id);
        const totalShifts = myAssigns.length;

        let totalHours = 0;
        let weekends = 0;
        let nights = 0;

        // Initialize shift counts
        const shiftCounts = {};
        shifts.forEach(s => shiftCounts[s.id] = 0);

        myAssigns.forEach(a => {
            const shift = shifts.find(s => s.id === a.shift_id) || { start_time: '00:00', end_time: '00:00' };

            // Count Shift Type
            if (shiftCounts[shift.id] !== undefined) {
                shiftCounts[shift.id]++;
            }

            // Hours
            const startH = parseInt(shift.start_time.split(':')[0]) + parseInt(shift.start_time.split(':')[1])/60;
            let endH = parseInt(shift.end_time.split(':')[0]) + parseInt(shift.end_time.split(':')[1])/60;
            if (endH < startH) endH += 24;
            totalHours += (endH - startH);

            // Weekend
            // Parse date manually to avoid timezone issues with Date()
            const [y, m, d] = a.date.split('-').map(Number);
            const dateObj = new Date(y, m - 1, d); // Local time 00:00:00

            // Get current site config
            const siteId = parseInt(document.getElementById('site-dashboard-section').dataset.siteId);
            const site = adminSites.find(s => s.id === siteId);

            if (window.isWeekendShift && window.isWeekendShift(dateObj, shift, site)) {
                weekends++;
            }

            // Night
            // Simple heuristic reused from scheduler.js or basic check
            if (endH > 24 || startH >= 20) nights++;
        });

        html += `<tr>
            <td>${escapeHTML(u.username)}</td>
            <td>${totalShifts}</td>
            <td>${totalHours.toFixed(1)}</td>
            <td>${weekends}</td>
            <td>${nights}</td>`;

        // Render Shift Counts
        shifts.forEach(s => {
            html += `<td>${shiftCounts[s.id]}</td>`;
        });

        html += `</tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

window.updateAssignment = async (siteId, date, userId, shiftId) => {
    // shiftId might be empty string if cleared
    try {
        // If assigning a new shift manually, default to LOCKED (true)
        // If clearing (shiftId=''), isLocked doesn't matter much but we can send false
        await apiClient.put('/api/schedule/assignment', { siteId, date, userId, shiftId, isLocked: !!shiftId });
        loadSchedule(); // Refresh to show lock icon
    } catch(e) {
        alert('Error updating assignment: ' + e.message);
    }
};

window.toggleAssignmentLock = async (siteId, date, userId, shiftId, currentIsLocked) => {
    try {
        await apiClient.put('/api/schedule/assignment', {
            siteId, date, userId, shiftId, isLocked: !currentIsLocked
        });
        loadSchedule();
    } catch(e) {
        alert('Error toggling lock: ' + e.message);
    }
};

window.lockAllAssignments = async (isLocked) => {
    const params = getScheduleParams();
    if(!params.siteId || !params.startDate) return;

    // Calculate endDate
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m - 1, d);
    const endObj = new Date(startObj);
    endObj.setDate(startObj.getDate() + parseInt(params.days) - 1);
    const endDate = window.toDateStr(endObj);

    if (!confirm(`Are you sure you want to ${isLocked ? 'LOCK' : 'UNLOCK'} ALL assignments for this month?`)) return;

    try {
        await apiClient.post('/api/schedule/lock-all', {
            siteId: params.siteId,
            startDate: params.startDate,
            endDate,
            isLocked
        });
        loadSchedule();
    } catch(e) {
        alert(e.message);
    }
};

window.clearSchedule = async () => {
    const params = getScheduleParams();
    if(!params.siteId || !params.startDate) return;

    // Calculate endDate
    const [y, m, d] = params.startDate.split('-').map(Number);
    const startObj = new Date(y, m - 1, d);
    const endObj = new Date(startObj);
    endObj.setDate(startObj.getDate() + parseInt(params.days) - 1);
    const endDate = window.toDateStr(endObj);

    if (!confirm('Are you sure you want to CLEAR ALL assignments for this month? This cannot be undone unless you have a snapshot.')) return;

    try {
        await apiClient.post('/api/schedule/clear', {
            siteId: params.siteId,
            startDate: params.startDate,
            endDate
        });
        loadSchedule();
    } catch(e) {
        alert(e.message);
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
                    <td>${escapeHTML(s.description)}</td>
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
        const manualBadge = c.is_manual ? '<span class="badge bg-secondary">Yes</span>' : '';
        tbody.innerHTML += `
            <tr>
                <td>${c.priority}</td>
                <td><span class="badge" style="background-color: ${escapeHTML(c.color)}; color: #000; border: 1px solid #ccc;">${escapeHTML(c.name)}</span></td>
                <td><div style="width: 20px; height: 20px; background-color: ${escapeHTML(c.color)}; border: 1px solid #ccc;"></div></td>
                <td>${manualBadge}</td>
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
    document.getElementById('cat-is-manual').checked = cat ? !!cat.is_manual : false;

    new bootstrap.Modal(document.getElementById('categoryModal')).show();
};

window.saveCategory = async () => {
    const siteId = document.getElementById('site-dashboard-section').dataset.siteId;
    const id = document.getElementById('cat-id').value;
    const body = {
        name: document.getElementById('cat-name').value,
        priority: document.getElementById('cat-priority').value,
        color: document.getElementById('cat-color').value,
        is_manual: document.getElementById('cat-is-manual').checked
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

// Helper for XSS prevention
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag]));
}

// Bulk Add Logic
let currentBulkType = null;

window.openBulkModal = (type) => {
    currentBulkType = type;
    const title = type === 'users' ? 'Bulk Add Users' : 'Bulk Add Sites';
    const desc = type === 'users' ? 'Paste usernames (e.g. "john_doe" or "john_doe|admin"), one per line.' : 'Paste site names, one per line.';

    document.getElementById('bulk-modal-title').textContent = title;
    document.getElementById('bulk-modal-desc').textContent = desc;
    document.getElementById('bulk-input-text').value = '';
    document.getElementById('bulk-results').classList.add('d-none');

    new bootstrap.Modal(document.getElementById('bulkAddModal')).show();
};

window.processBulkAdd = async () => {
    const text = document.getElementById('bulk-input-text').value;
    if(!text.trim()) return;

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    if(lines.length === 0) return;

    let body = {};
    let url = '';

    if (currentBulkType === 'users') {
        url = '/api/users/bulk';
        const users = lines.map(l => {
            const parts = l.split('|');
            return { username: parts[0].trim(), role: (parts[1] || 'user').trim().toLowerCase() };
        });
        body = { users };
    } else {
        url = '/api/sites/bulk';
        const sites = lines.map(l => ({ name: l }));
        body = { sites };
    }

    try {
        const res = await apiClient.post(url, body);

        // Show results
        const resultEl = document.getElementById('bulk-results');
        resultEl.classList.remove('d-none', 'alert-info', 'alert-success', 'alert-warning');

        let html = `<strong>Processed ${lines.length} items.</strong><br>`;
        if (res.added.length > 0) html += `<span class="text-success">Successfully added: ${res.added.length}</span><br>`;
        if (res.failed.length > 0) {
            html += `<span class="text-danger">Failed: ${res.failed.length}</span>`;
            html += `<ul class="mb-0 small">`;
            res.failed.forEach(f => html += `<li>${escapeHTML(f.item)}: ${escapeHTML(f.reason)}</li>`);
            html += `</ul>`;
        }

        resultEl.innerHTML = html;
        resultEl.classList.add(res.failed.length > 0 ? 'alert-warning' : 'alert-success');

        // Refresh Lists
        if (currentBulkType === 'users') loadUsers();
        else loadSites();

    } catch(e) {
        alert('Error: ' + e.message);
    }
};

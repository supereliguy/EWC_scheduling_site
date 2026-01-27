document.addEventListener('DOMContentLoaded', () => {
    const userSelect = document.getElementById('user');
    const otherUserInp = document.getElementById('other-user');
    const workBtn = document.getElementById('work-btn');
    const offBtn = document.getElementById('off-btn');
    const clearBtn = document.getElementById('clear-btn');
    const calendarGrid = document.getElementById('calendar');
    const submitBtn = document.getElementById('submit-btn');
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');
    const monthYearDisplay = document.getElementById('month-year-display');
    const selectorModal = document.getElementById('selector-modal');
    const selectorYear = document.getElementById('selector-year');
    const monthSelector = document.getElementById('month-selector');
    const prevYearBtn = document.getElementById('prev-year-btn');
    const nextYearBtn = document.getElementById('next-year-btn');
    const gotoTodayBtn = document.getElementById('goto-today-btn');
    const clearMonthBtn = document.getElementById('clear-month-btn');

    let currentPaintMode = null;
    let currentDate = new Date();
    let isPainting = false;
    let selectorCurrentYear = currentDate.getFullYear();

    // Stop painting when the mouse is released anywhere on the page
    document.addEventListener('mouseup', () => {
        isPainting = false;
    });

    // Close modal on escape key
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && selectorModal.style.display !== 'none') {
            selectorModal.style.display = 'none';
        }
    });

    userSelect.addEventListener('change', () => {
        if (userSelect.value === 'other') {
            otherUserInp.style.display = 'block';
        } else {
            otherUserInp.style.display = 'none';
        }
    });

    workBtn.addEventListener('click', () => {
        currentPaintMode = 'work';
        workBtn.style.border = '2px solid blue';
        offBtn.style.border = 'none';
        clearBtn.style.border = 'none';
    });

    offBtn.addEventListener('click', () => {
        currentPaintMode = 'off';
        offBtn.style.border = '2px solid blue';
        workBtn.style.border = 'none';
        clearBtn.style.border = 'none';
    });

    clearBtn.addEventListener('click', () => {
        currentPaintMode = 'clear';
        clearBtn.style.border = '2px solid blue';
        workBtn.style.border = 'none';
        offBtn.style.border = 'none';
    });

    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        generateCalendar(currentDate);
    });

    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        generateCalendar(currentDate);
    });

    monthYearDisplay.addEventListener('click', () => {
        selectorModal.style.display = 'flex';
        updateMonthSelector();
    });

    selectorModal.addEventListener('click', (e) => {
        if (e.target === selectorModal) {
            selectorModal.style.display = 'none';
        }
    });

    prevYearBtn.addEventListener('click', () => {
        selectorCurrentYear--;
        updateMonthSelector();
    });

    nextYearBtn.addEventListener('click', () => {
        selectorCurrentYear++;
        updateMonthSelector();
    });

    gotoTodayBtn.addEventListener('click', () => {
        currentDate = new Date();
        selectorModal.style.display = 'none';
        generateCalendar(currentDate);
    });

    clearMonthBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all selections for this month?')) {
            document.querySelectorAll('.calendar-day').forEach(dayEl => {
                dayEl.classList.remove('work', 'off');
            });
        }
    });

    function applyPaint(dayEl) {
        if (currentPaintMode) {
            dayEl.classList.remove('work', 'off');
            if (currentPaintMode !== 'clear') {
                dayEl.classList.add(currentPaintMode);
            }
        }
    }

    calendarGrid.addEventListener('mousedown', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl) {
            isPainting = true;
            applyPaint(dayEl);
        }
    });

    calendarGrid.addEventListener('mouseover', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (dayEl && isPainting) {
            applyPaint(dayEl);
        }
    });

    function updateMonthSelector() {
        selectorYear.textContent = selectorCurrentYear;
        monthSelector.innerHTML = '';
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        months.forEach((month, index) => {
            const monthBtn = document.createElement('button');
            monthBtn.textContent = month;
            monthBtn.addEventListener('click', () => {
                currentDate.setFullYear(selectorCurrentYear, index, 1);
                selectorModal.style.display = 'none';
                generateCalendar(currentDate);
            });
            monthSelector.appendChild(monthBtn);
        });
    }

    function generateCalendar(date) {
        calendarGrid.innerHTML = '';
        const year = date.getFullYear();
        const month = date.getMonth();
        monthYearDisplay.textContent = `${date.toLocaleString('default', { month: 'long' })} ${year}`;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekdays.forEach(day => {
            const dayEl = document.createElement('div');
            dayEl.textContent = day;
            dayEl.style.fontWeight = 'bold';
            calendarGrid.appendChild(dayEl);
        });

        for (let i = 0; i < firstDay.getDay(); i++) {
            const emptyCell = document.createElement('div');
            calendarGrid.appendChild(emptyCell);
        }

        for (let i = 1; i <= lastDay.getDate(); i++) {
            const dayEl = document.createElement('div');
            dayEl.textContent = i;
            dayEl.classList.add('calendar-day');
            dayEl.dataset.day = i;
            calendarGrid.appendChild(dayEl);
        }
    }

    submitBtn.addEventListener('click', () => {
        const user = userSelect.value === 'other' ? otherUserInp.value : userSelect.value;
        if (!user) {
            alert('Please select or enter a user.');
            return;
        }

        const schedule = {};
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        document.querySelectorAll('.calendar-day').forEach(dayEl => {
            const day = dayEl.dataset.day;
            let status = 'unselected';
            if (dayEl.classList.contains('work')) {
                status = 'work';
            } else if (dayEl.classList.contains('off')) {
                status = 'off';
            }
            schedule[day] = status;
        });

        const data = {
            user,
            year,
            month,
            schedule
        };

        // Replace with your Google Apps Script URL
        const googleAppsScriptUrl = 'YOUR_GOOGLE_APPS_SCRIPT_URL';

        fetch(googleAppsScriptUrl, {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).then(res => res.json()).then(data => {
            if (data.status === 'success') {
                alert('Schedule submitted successfully!');
            } else {
                alert(`An error occurred: ${data.message}`);
            }
        }).catch(error => {
            console.error('Error:', error);
            alert('An error occurred while submitting the schedule. Please try again.');
        });
    });

    generateCalendar(currentDate);
});

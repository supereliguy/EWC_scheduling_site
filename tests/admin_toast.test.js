/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

// Mock window.api
window.api = { request: jest.fn() };

// Mock Bootstrap
window.bootstrap = {
    Toast: {
        getOrCreateInstance: jest.fn(() => ({ show: jest.fn() }))
    },
    Modal: class {
        constructor() {}
        show() {}
        hide() {}
        static getInstance() { return { hide: () => {} }; }
    }
};

describe('Admin Toast Notification', () => {
    beforeAll(() => {
        // Setup minimal DOM required for admin.js to load without error
        document.body.innerHTML = `
            <select id="req-site-select"></select>
            <button id="create-user-btn"></button>
            <button id="create-site-btn"></button>
            <button id="create-shift-btn"></button>
            <button id="generate-schedule-btn"></button>
            <table id="bulk-metrics-table"></table>

            <!-- Toast Container -->
            <div id="liveToast" class="toast">
                <div class="toast-body" id="toast-body"></div>
                <button class="btn-close"></button>
            </div>
        `;

        // Load admin.js content
        const adminJsContent = fs.readFileSync(path.resolve(__dirname, '../admin.js'), 'utf8');
        // Evaluate in global scope
        try {
            eval(adminJsContent);
        } catch (e) {
            console.error("Error loading admin.js in test:", e);
        }
    });

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Reset DOM state relevant to toast if needed, though innerHTML above is static for beforeAll.
        // If showToast modifies classes, we might need to reset them.
        const toastEl = document.getElementById('liveToast');
        if (toastEl) toastEl.className = 'toast';
    });

    test('showToast is defined', () => {
        expect(typeof window.showToast).toBe('function');
    });

    test('showToast updates DOM and shows toast via Bootstrap', () => {
        const message = 'Test Message';
        const type = 'success';

        window.showToast(message, type);

        const toastBody = document.getElementById('toast-body');
        const toastEl = document.getElementById('liveToast');

        expect(toastBody.textContent).toBe(message);
        expect(toastEl.classList.contains('text-bg-success')).toBe(true);
        expect(window.bootstrap.Toast.getOrCreateInstance).toHaveBeenCalledWith(toastEl);
    });

    test('showToast handles warning type correctly (text color)', () => {
        window.showToast('Warning', 'warning');
        const closeBtn = document.querySelector('.btn-close');
        expect(closeBtn.classList.contains('btn-close-white')).toBe(false);
    });

    test('showToast handles danger type correctly (text color)', () => {
        window.showToast('Error', 'danger');
        const closeBtn = document.querySelector('.btn-close');
        expect(closeBtn.classList.contains('btn-close-white')).toBe(true);
    });
});

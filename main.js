const { app, BrowserWindow } = require('electron');
const path = require('path');

// Determine Database Path
let dbPath;
if (app.isPackaged) {
    // In production
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        // Portable Mode (e.g. USB): Use the directory of the executable
        dbPath = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'schedule.db');
    } else {
        // Installed Mode: Use AppData (Standard)
        dbPath = path.join(app.getPath('userData'), 'schedule.db');
    }
} else {
    // Development Mode
    dbPath = path.join(__dirname, 'schedule.db');
}

// Set environment variable for db.js to use
process.env.DB_PATH = dbPath;
console.log(`Database Location: ${dbPath}`);

const expressApp = require('./src/app');

let server;
let mainWindow;
const PORT = 3000;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true, // We might need this later, but usually safer off.
            // For now, let's keep it standard webview style.
        },
        autoHideMenuBar: true
    });

    mainWindow.loadURL(`http://localhost:${PORT}/admin.html`);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

function startServer() {
    return new Promise((resolve, reject) => {
        server = expressApp.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            resolve();
        });
        server.on('error', (err) => {
             console.error('Failed to start server:', err);
             reject(err);
        });
    });
}

app.on('ready', () => {
    startServer().then(createWindow).catch(err => {
        console.error('Error starting server:', err);
        app.quit();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (server) {
        server.close();
    }
});

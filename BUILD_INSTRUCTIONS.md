# Building Ultimate Scheduler

This guide explains how to build the application into a standalone Windows executable (`.exe`).

## Prerequisites

1.  **Node.js**: Ensure Node.js is installed (Version 18+ recommended).
2.  **Internet Connection**: Required to download Electron binaries during the build process.

## One-Time Setup

Open a terminal (Command Prompt or PowerShell) in the project folder and run:

```bash
npm install
```

This will download all necessary tools.

## Creating the Executable

To build the application for Windows, run:

```bash
npm run dist
```

This process may take a few minutes.

## Output

Once the build finishes, look in the `dist/` folder. You will see:

1.  **`Ultimate Scheduler Setup 2.0.1.exe`**: Standard installer. Installs the app to your computer.
2.  **`UltimateScheduler_Portable.exe`**: Portable version. You can copy this single file to a USB stick and run it anywhere.

## Which one should I use?

*   **For your own PC:** Use the **Setup** file. It installs the app properly and creates a desktop shortcut.
*   **For USB / Moving between computers:** Use the **Portable** file. It keeps your data alongside the executable (if running from a USB) or in a temporary location.
    *   *Note on Portable Data:* If you run the Portable app from a USB drive, it will try to save your database (`schedule.db`) to that same USB drive folder, allowing you to carry your schedule with you.

## Troubleshooting

*   **Build Fails:** If the build fails, ensure you have no other instances of the app running.
*   **"Electron not recognized"**: Ensure you ran `npm install` successfully.

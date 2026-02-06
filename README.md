# Local Schedule Manager

A local, offline desktop application for managing work schedules. Built with Electron, Node.js, and SQLite.

## Features

*   **Local & Secure:** No cloud server, all data stored locally on your machine in `schedule.db`.
*   **Smart Scheduling:** Randomized greedy algorithm that respects:
    *   Hard constraints (Locked assignments, Max consecutive shifts).
    *   Circadian Rhythms (Strict & Soft constraints).
    *   User Preferences (Shift Rankings, Block Sizes, Targets).
*   **Manual Control:** Spreadsheet-style editor to pre-assign or fix shifts.
*   **Recovery:** Snapshot system to save/restore database states.

## Installation & Running (Source Code)

1.  Install [Node.js](https://nodejs.org/).
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the application:
    ```bash
    npm start
    ```
    Or run `start.bat` on Windows.

## Building for Windows (Creating .exe)

To create a standalone installer or portable USB version:

1.  Run the build command:
    ```bash
    npm run dist
    ```
2.  Find the generated `.exe` files in the `dist/` folder.
    *   `UltimateScheduler_Portable.exe`: Runs without installation (great for USBs).
    *   `Ultimate Scheduler Setup...exe`: Standard installer.

See `BUILD_INSTRUCTIONS.md` for more details.

## Development

*   `main.js`: Electron entry point.
*   `src/app.js`: Express backend (running locally).
*   `src/lib/scheduler.js`: Scheduling algorithm.
*   `public/`: Frontend assets.

# Ultimate Scheduler (Web Edition)

This is a **client-side only** version of the Ultimate Scheduler. It runs entirely in your browser using `sql.js` (WebAssembly SQLite) and IndexedDB for persistence.

## Features

*   **Zero Install:** Runs directly in any modern browser.
*   **Local Persistence:** Data is saved to your browser's local storage.
*   **Export/Import:** Backup your database to a file and restore it on another device.
*   **Privacy:** No data is sent to any server. Everything stays on your machine.
*   **Schedule Generation:** Automated scheduling algorithm runs locally.

## Hosting on GitHub Pages

1.  Push this repository to GitHub.
2.  Go to **Settings** -> **Pages**.
3.  Set **Source** to `Deploy from a branch`.
4.  Select `main` (or your default branch) and `/ (root)`.
5.  Save.
6.  Your site will be live at `https://<username>.github.io/<repo-name>/`.

## Local Development

You can run this locally using any static file server.

```bash
npm start
```
(Requires `npx` installed via Node.js, but the app itself needs no Node.js backend).

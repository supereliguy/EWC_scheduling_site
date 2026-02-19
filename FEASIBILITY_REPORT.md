# Feasibility Report: Transition to Client-Server Architecture

## 1. Executive Summary

Transitioning the current "Ultimate Scheduler" from a purely client-side application (running entirely in the browser) to a client-server architecture is **highly feasible** and carries a **moderate complexity** level.

We are adopting a **Cloudflare Tunnel** based approach for secure, easy remote access without port forwarding.

**Key Benefits:**
*   **Secure Remote Access:** Cloudflare Tunnel (`cloudflared`) securely exposes the local server to the internet without opening router ports.
*   **Centralized Data (Future):** The database will live on the server, accessible from any device.
*   **User Accounts (Future):** Authenticatable users with specific roles (Admin vs User).

**Recommendation:** Proceed with a **Node.js + Express** backend served via **Cloudflare Tunnel**. This stack mirrors the current architecture (JS + SQL) almost 1:1, minimizing rewrite effort and simplifying deployment on your Ubuntu VM.

---

## 2. Proposed Architecture: "Dual Mode"

To meet your requirement of maintaining the current "manual/offline" functionality while adding server capabilities, we propose a **Dual Mode** architecture.

### A. The "Smart" Frontend
The frontend code (`admin.js`, `scheduler.js`, `index.html`) remains largely unchanged. We will introduce a **Configuration Toggle** (e.g., `config.js`) that tells the app where to send data:

1.  **Server Mode (Online)**:
    *   The app sends standard HTTP requests (`fetch`) to your Ubuntu server (e.g., `https://schedule.yourdomain.com/api/...`).
    *   Authentication is required (Login screen).
    *   Data is stored in `server/database.sqlite`.

2.  **Local Mode (Offline/Legacy)**:
    *   The app uses the existing `sql.js` (in-browser SQLite).
    *   No internet required.
    *   Data is stored in the browser's IndexedDB (just like today).
    *   *This acts as your fallback if the server is down or you want to work manually.*

### B. The Backend (Node.js)
We have created a `server/` directory containing:
*   **Express.js**: Web server framework.
*   **Cloudflare Tunnel**: Securely exposes the application to the web.

---

## 3. Implementation Plan

### Phase 1: Server Skeleton & Deployment (Completed)
*   Initialize a Node.js project.
*   Create a basic Express server to serve the existing frontend files (`index.html`, `admin.js`, etc.).
*   Deploy to Ubuntu VM using Cloudflare Tunnel.
*   *Result:* The application is accessible online at `https://schedule.yourdomain.com`, but still runs entirely in the browser (client-side logic).

### Phase 2: Database Migration (Next Steps)
*   Install `better-sqlite3`, `bcrypt`, `jsonwebtoken`.
*   Adapt `db-wrapper.js` logic to run on the server using `better-sqlite3`.
*   Port `api-router.js` logic into real Express routes.

### Phase 3: Authentication & Permissions
*   Create a `login.html` page.
*   Implement `/api/auth/login` endpoint.
*   Protect Admin routes.

### Phase 4: Frontend "Switch"
*   Modify `admin.js` to intelligently switch between Server Mode and Local Mode.

---

## 4. Hosting Instructions (Ubuntu VM on Proxmox)

**See `DEPLOY_INSTRUCTIONS.md` for the detailed, step-by-step guide.**

### Summary of Deployment
1.  **Install Node.js**: The runtime environment for the server.
2.  **Clone Repository**: Get the code onto the VM.
3.  **Install Dependencies**: `npm install` inside the server directory.
4.  **Install Cloudflare Tunnel**: Download and install `cloudflared`.
5.  **Authenticate & Configure**: Link the tunnel to your Cloudflare account and domain.
6.  **Auto-Start Services**: Use `systemd` to ensure both the Node.js server and the Cloudflare Tunnel start automatically on boot.

---

## 5. Risks & Considerations

1.  **Data Synchronization**: The "Dual Mode" does **not** automatically sync data between your local browser (Offline) and the server (Online).
    *   *Scenario:* If you work offline on a flight, that data stays on your laptop. When you land and connect to the server, you won't see those changes unless you manually "Export" from Offline and "Import" to Server.
    *   *Recommendation:* Use Server Mode as your primary tool. Use Offline Mode only for emergencies.

2.  **Backups**: On the server, the database is just a file (`database.sqlite`).
    *   *Simple Backup Plan:* A cron job that copies this file to a backup folder every night.

## 6. Conclusion

This project is feasible and the first phase (Deployment) is ready to go. The use of Cloudflare Tunnel significantly simplifies the networking setup, making it robust and secure without complex router configuration.

# Feasibility Report: Transition to Client-Server Architecture

## 1. Executive Summary

Transitioning the current "Ultimate Scheduler" from a purely client-side application (running entirely in the browser) to a client-server architecture is **highly feasible** and carries a **moderate complexity** level (estimated 3-5 days of development).

The existing codebase is well-structured, with a clear separation between the UI (`admin.js`, `index.html`) and the data/logic layer (`api-router.js`, `scheduler.js`). This separation makes "lifting and shifting" the backend logic to a real Node.js server straightforward.

**Key Benefits:**
*   **Centralized Data:** The database lives on the server, accessible from any device.
*   **User Accounts:** Authenticatable users with specific roles (Admin vs User).
*   **Security:** Sensitive admin functions are protected behind a server-side login.
*   **Performance:** Offloads heavy scheduling computations to the server (optional but recommended).

**Recommendation:** Proceed with a **Node.js + Express + SQLite** backend. This stack mirrors the current architecture (JS + SQL) almost 1:1, minimizing rewrite effort and simplifying deployment on your Ubuntu VM.

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
We will create a new `server/` directory containing:
*   **Express.js**: Web server framework.
*   **Better-SQLite3**: A high-performance Node.js library for SQLite (faster than `sql.js`).
*   **Passport.js / JWT**: For secure Username/Password authentication (with optional SSO hooks).

---

## 3. Implementation Plan

### Phase 1: Server Skeleton & Database
*   Initialize a Node.js project.
*   Install dependencies: `express`, `better-sqlite3`, `bcrypt` (password hashing), `jsonwebtoken` (auth).
*   **Database Migration**: The existing `db-wrapper.js` logic can be adapted to run on the server using `better-sqlite3`. The schema remains identical.

### Phase 2: API Porting
*   The current `api-router.js` file simulates a server. We will copy its logic into real Express routes.
*   *Example:*
    *   **Current:** `api.get('/api/users', ...)`
    *   **New Server:** `app.get('/api/users', (req, res) => { ... })`
*   This is a copy-paste-refactor job, very low risk.

### Phase 3: Authentication & Permissions
*   Create a `login.html` page.
*   Implement `/api/auth/login` endpoint.
*   Protect Admin routes (e.g., `POST /api/users`, `POST /api/schedule/generate`) with middleware that checks for "Admin" role.
*   Protect User routes so users can only edit their *own* requests.

### Phase 4: Frontend "Switch"
*   Modify `admin.js` to check the mode:
    ```javascript
    const apiClient = {
        get: async (url) => {
            if (USE_SERVER) return await fetch(url).then(r => r.json());
            else return await window.api.request('GET', url); // Legacy
        }
    };
    ```

---

## 4. Hosting Instructions (Ubuntu VM on Proxmox)

Here is the "simplest process possible" to host the backend on your Ubuntu VM.

### Prerequisites
*   Ubuntu 20.04 or 22.04 VM.
*   SSH Access.
*   A domain name (optional, but recommended for SSL) or just IP address.

### Step 1: Install Node.js & Nginx
```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js (v18 or v20)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Nginx (Web Server / Proxy)
sudo apt install -y nginx
```

### Step 2: Deploy the App
*(Assuming you push the code to a Git repository)*
```bash
# 1. Clone your repo
git clone https://github.com/your-repo/schedule-app.git
cd schedule-app

# 2. Install Server Dependencies
cd server
npm install

# 3. Start the server (Test)
node server.js
# (Press Ctrl+C to stop)
```

### Step 3: Setup Systemd (Auto-start on boot)
Create a service file to keep the app running.
`sudo nano /etc/systemd/system/schedule-app.service`

```ini
[Unit]
Description=Schedule App Backend
After=network.target

[Service]
User=root
WorkingDirectory=/root/schedule-app/server
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

**Enable and Start:**
```bash
sudo systemctl enable schedule-app
sudo systemctl start schedule-app
```

### Step 4: Configure Nginx (Reverse Proxy)
This makes your app accessible on port 80 (HTTP) instead of 3000.
`sudo nano /etc/nginx/sites-available/schedule-app`

```nginx
server {
    listen 80;
    server_name your-domain.com OR_YOUR_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Activate:**
```bash
sudo ln -s /etc/nginx/sites-available/schedule-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 5. Risks & Considerations

1.  **Data Synchronization**: The "Dual Mode" does **not** automatically sync data between your local browser (Offline) and the server (Online).
    *   *Scenario:* If you work offline on a flight, that data stays on your laptop. When you land and connect to the server, you won't see those changes unless you manually "Export" from Offline and "Import" to Server (we can keep the Import/Export feature for this!).
    *   *Recommendation:* Use Server Mode as your primary tool. Use Offline Mode only for emergencies or testing.

2.  **Complexity of SSO**: Adding Google/Microsoft Single Sign-On (SSO) increases setup time by ~2-4 hours and requires configuring OAuth credentials in Google Cloud Console.
    *   *Recommendation:* Start with Username/Password. Add SSO later if typing passwords becomes annoying.

3.  **Backups**: On the server, the database is just a file (`database.sqlite`).
    *   *Simple Backup Plan:* A cron job that copies this file to a backup folder every night.
    *   `0 3 * * * cp /root/schedule-app/server/database.sqlite /root/backups/db_$(date +\%F).sqlite`

## 6. Conclusion

This project is feasible and a natural next step for your application. By leveraging your existing code structure, we can enable multi-user access and centralized management without rewriting the core scheduling logic. The "Dual Mode" approach ensures you never lose the ability to run the app locally, satisfying your fallback requirement.

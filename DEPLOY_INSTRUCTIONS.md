# Foolproof Deployment Instructions: Cloudflare Tunnel on Ubuntu VM

These instructions are designed for a **fresh Ubuntu Server (20.04 or 22.04 LTS)** installation. They assume you have root access (using `sudo`) and a domain managed by Cloudflare.

**Goal:**
1.  Install Node.js & dependencies.
2.  Deploy the Schedule App.
3.  Set up Cloudflare Tunnel (`cloudflared`) to expose the app securely.
4.  Configure everything to auto-start on reboot.

---

## 1. Initial System Setup (Run as Root)

To make things easy, we will switch to the `root` user for setup. This avoids permission errors.

```bash
# Switch to root user
sudo -i

# Update your system packages
apt update && apt upgrade -y

# Install essential tools
apt install -y curl git gnupg2 build-essential
```

---

## 2. Install Node.js (Version 20)

We will use the official NodeSource repository to install the latest stable Node.js.

```bash
# Download and run the setup script for Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install Node.js
apt install -y nodejs

# Verify installation (should print v20.x.x)
node -v
```

---

## 3. Download & Configure the App

We will clone your repository to the `/opt/schedule-app` directory. This is a standard location for server applications.

**Note:** You will need your repository URL. If it's private, you might need to use a Personal Access Token or SSH key. For public repos, just the HTTPS URL works.

```bash
# 1. Clone the repository (REPLACE THE URL BELOW WITH YOUR ACTUAL REPO URL)
# Example: git clone https://github.com/yourusername/schedule-app.git /opt/schedule-app
git clone <YOUR_REPO_URL_HERE> /opt/schedule-app

# 2. Go into the server directory
cd /opt/schedule-app/server

# 3. Install dependencies
npm install
```

### Create the App Service (Auto-Start)
This tells Ubuntu to run your app automatically in the background.

```bash
# Create the service file
cat <<EOF > /etc/systemd/system/schedule-app.service
[Unit]
Description=Schedule App Backend
After=network.target

[Service]
# Run as root for simplicity (can be changed to a specific user later)
User=root
WorkingDirectory=/opt/schedule-app/server
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd to recognize the new service
systemctl daemon-reload

# Enable the service to start on boot
systemctl enable schedule-app

# Start the service now
systemctl start schedule-app

# Check status (should say "active (running)")
systemctl status schedule-app --no-pager
```

---

## 4. Install Cloudflare Tunnel (`cloudflared`)

Now we expose the app to the internet securely.

```bash
# 1. Add Cloudflare's GPG key
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

# 2. Add Cloudflare's Repo
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list

# 3. Update apt and install cloudflared
apt update
apt install -y cloudflared
```

---

## 5. Authenticate & Create Tunnel

This step requires you to copy a link from the terminal and open it in your browser on your computer.

1.  **Run Login Command:**
    ```bash
    cloudflared tunnel login
    ```
2.  **Authenticate:**
    *   The terminal will show a URL (e.g., `https://discord.cloudflare.com/...`).
    *   Copy that URL and paste it into your browser.
    *   Log in to Cloudflare and select your domain (e.g., `yourdomain.com`).
    *   Once approved, the terminal will say "Successfully logged in".

3.  **Create the Tunnel:**
    We'll name it `schedule-tunnel`.
    ```bash
    cloudflared tunnel create schedule-tunnel
    ```
    *   **IMPORTANT:** Copy the **Tunnel ID** shown in the output (a long string like `d4f3a1b2-...`). You'll need it in a moment.

4.  **Route DNS (Connect Domain):**
    Decide on the subdomain (e.g., `schedule.yourdomain.com`).
    ```bash
    # Replace <Tunnel-Name> with 'schedule-tunnel'
    # Replace <hostname> with your desired full URL (e.g. schedule.example.com)
    cloudflared tunnel route dns schedule-tunnel schedule.example.com
    ```

---

## 6. Configure Tunnel Service

We will set up the tunnel to run automatically using the standard system location `/etc/cloudflared/`.

```bash
# 1. Create the configuration directory
mkdir -p /etc/cloudflared/

# 2. Copy your tunnel credentials (generated in Step 5) to the system folder
cp ~/.cloudflared/*.json /etc/cloudflared/

# 3. Create the config file (REPLACE <Tunnel-ID> and <hostname> below!)
# You can find your ID by running: ls /etc/cloudflared/*.json

cat <<EOF > /etc/cloudflared/config.yml
tunnel: <YOUR_TUNNEL_UUID_HERE>
credentials-file: /etc/cloudflared/<YOUR_TUNNEL_UUID_HERE>.json

ingress:
  # Route traffic to the local Node.js app
  - hostname: schedule.example.com
    service: http://localhost:3000
  # Catch-all rule (required)
  - service: http_status:404
EOF
```

**Verify Configuration:**
*   Make sure `<YOUR_TUNNEL_UUID_HERE>` matches the ID in the `.json` filename in `/etc/cloudflared/`.
*   Make sure `schedule.example.com` matches what you set in Step 5.4.

### Install Tunnel as a Service
This ensures the tunnel starts automatically on boot.

```bash
# Install the system service
cloudflared service install

# Start the service
systemctl start cloudflared

# Check status (should be active)
systemctl status cloudflared --no-pager
```

---

## 7. Verification

1.  Open your browser to `https://schedule.example.com` (your chosen domain).
2.  You should see the "Ultimate Scheduler" loading screen!
3.  **Reboot Test:**
    Run `reboot` on the VM. Wait a minute, then try to access the site again. It should come back up automatically.

---

## Troubleshooting

*   **App not loading?** Check app logs:
    `journalctl -u schedule-app -f`
*   **Tunnel error?** Check tunnel logs:
    `journalctl -u cloudflared -f`
*   **Permission Denied?** Ensure you ran everything as root (`sudo -i`).

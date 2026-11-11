# Bannerlord Server Dashboard

## this is a community project not made or supported by the Coop mod team.
A self-hosted web dashboard for the [Bannerlord Coop Server Manager](https://github.com/PlodyIce/bannerlordcoop-server-manager). The dashboard provides server controls, campaign and mod management, backups, save import/export, player moderation, a restricted Coop console, and world settings.

## One-command installation

### Requirements

- Linux host with the Bannerlord Coop Server Manager installed.
- Node.js 22.12 or newer and npm, available to the Linux account running the installer.
- `sudo`, `visudo`, and `runuser`. PM2 configures boot startup for the detected Linux init system (commonly systemd or OpenRC).
- A normal Linux user account that can run `coop`.

From the extracted project directory, run:

```bash
sudo bash install.sh
```

The installer detects the invoking Linux user, locates `coop`, builds the Vite frontend, installs production dependencies under `/opt/bannerlord-dashboard`, installs the root-owned command helper, creates a narrowly scoped sudoers rule, and starts the Express server with PM2. It also configures PM2 to restore the dashboard after reboot.

The installer uses `/opt/bannerlord-dashboard` for application files and `/usr/local/sbin/bannerlord-dashboard-command` for the privileged command helper. Existing application files and helper scripts are backed up with a timestamp before replacement. It does not modify Bannerlord campaigns, saves, server configuration, Docker, or the Coop manager installation.

If automatic path detection is not suitable, you can override the detected paths:

```bash
sudo env COOP_BIN=/absolute/path/to/coop \
  BANNERLORD_SAVE_DIR="/absolute/path/to/Game Saves" \
  BANNERLORD_MOD_CONFIG="/absolute/path/to/mod-config.json" \
  PORT=8787 bash install.sh
```

The installer does not open firewall ports or configure public access. Keep this passwordless dashboard on a trusted private LAN.

## After installation

```bash
pm2 status
pm2 logs bannerlord-dashboard
pm2 restart bannerlord-dashboard
hostname -I
```

Open `http://SERVER-LAN-IP:8787` from another device on the same trusted network. If the host firewall is enabled, allow TCP 8787 only from your LAN subnet. Do not port-forward this port or expose it through a public reverse proxy or tunnel.

The dashboard listens on `0.0.0.0` by default and restricts requests to private/local IP addresses. It does not require a password. Anyone on the trusted LAN who can reach it can operate the Coop server.

## Update

Replace the project files with the new release, then run:

```bash
sudo bash update.sh
```

This performs the same backup/build/install process, updates the helper and sudoers rule, and restarts only the `bannerlord-dashboard` PM2 process. Other PM2 applications are left alone.

## Uninstall

```bash
sudo bash uninstall.sh
```

The uninstaller asks for confirmation, removes the dashboard PM2 process, application files, helper, environment file, and sudoers rule. It does not uninstall PM2, remove PM2 startup for other applications, or delete Bannerlord server data. Timestamped backups are retained.

## Development

```bash
npm install
npm run dev:server
```

In a second terminal:

```bash
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to Express on `http://127.0.0.1:8787`.

Create the production frontend with:

```bash
npm run build
npm start
```

Express serves the generated `dist/` directory and the API from the same process.

## Security model

The web process runs as the Linux user who invoked the installer. It does not run as root. Server-side commands are executed through `/usr/bin/sudo -n` and a root-owned allowlisted helper. The helper is installed root-owned and is not writable by the dashboard user. The sudoers entry permits that user to invoke only this helper; the helper validates each action and its arguments.

Do not make the helper writable by the dashboard account. Do not expose the passwordless dashboard to the public internet. No Cloudflare, public tunnel, reverse proxy, analytics, or tracking configuration is installed.

## Troubleshooting

```bash
pm2 status
pm2 logs bannerlord-dashboard --lines 100
sudo -u "$USER" sudo -n /usr/local/sbin/bannerlord-dashboard-command status
sudo ss -ltnp | grep 8787
```

If the dashboard does not start after an update, check that PM2 is running under the same Linux account that ran the installer and inspect the PM2 logs.

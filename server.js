import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const SAVE_DIR = process.env.BANNERLORD_SAVE_DIR || '/srv/bannerlordcoop/server/server-data/Game Saves';
const upload = multer({ dest: os.tmpdir(), limits: { files: 2, fileSize: 256 * 1024 * 1024 } });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
}}}));
app.use(express.json({ limit: '32kb', strict: true }));
// No login is required, but requests are restricted to private/local network addresses.
app.use(requireLan);
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }));

function requireLan(req, res, next) {
  const raw = req.socket.remoteAddress || '';
  const address = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  let allowed = false;
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    allowed = octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  } else if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    allowed = normalized === '::1' || normalized.startsWith('fc')
      || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  if (!allowed) return res.status(403).send('This dashboard is available only from a private local network.');
  next();
}

// All CLI calls go through a root-owned helper. Never accept executable paths or raw shell strings from the browser.
function runCoop(args, { timeout = 30_000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sudo', ['-n', '/usr/local/sbin/bannerlord-dashboard-command', ...args], {
      shell: false, env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }
    });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Command timed out. Check the server over SSH.')); }, timeout);
    function finish(err, result) {
      if (settled) return; settled = true; clearTimeout(timer);
      if (err) reject(err); else resolve(result);
    }
    child.stdout.on('data', d => { stdout += d; if (stdout.length > maxBuffer) { child.kill('SIGTERM'); finish(new Error('Command output exceeded limit.')); } });
    child.stderr.on('data', d => { stderr += d; if (stderr.length > maxBuffer) { child.kill('SIGTERM'); finish(new Error('Command output exceeded limit.')); } });
    child.on('error', err => finish(err));
    child.on('close', code => code === 0 ? finish(null, { stdout: stdout.trim(), stderr: stderr.trim() }) : finish(new Error((stderr || stdout || `coop exited ${code}`).slice(-3000))));
  });
}
function parseJson(output) {
  try { return JSON.parse(output); } catch { return { raw: output }; }
}
function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const label = String(value.key || value.name || value.setting || '');
  const sensitive = /(password|secret|token|credential|steam)/i.test(label);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, (sensitive && /^(value|current_value)$/i.test(key)) || /(password|secret|token|credential|steam)/i.test(key) ? '[redacted]' : redactSecrets(item)]));
}
function str(value, name, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${name} is invalid.`);
  return value.trim();
}
function id(value, name = 'ID') {
  const v = str(value, name, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v)) throw new Error(`${name} contains unsupported characters.`);
  return v;
}
function steamId(value) {
  const v = str(value, 'Steam64 ID', 20);
  if (!/^7656119\d{10}$/.test(v)) throw new Error('Steam64 ID must be a 17-digit Steam ID.');
  return v;
}
function saveName(value) {
  const v = str(value, 'Save name', 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(v) || /\.backup[12]$/i.test(v)
      || /^(default_new_game|coop_bug_report|TransferSave)$/i.test(v)) {
    throw new Error('Save name contains unsupported characters or is reserved by the game.');
  }
  return v;
}
function cheatCommand(value) {
  const v = str(value, 'Cheat command', 500);
  if (!/^coop\.(?:debug\.[a-z0-9_.]+|unstuck)(?: [A-Za-z0-9 _.,:|+\-\"']{1,420})?$/i.test(v)) {
    throw new Error('Only Bannerlord Coop server-capable commands (coop.debug.* or coop.unstuck) are allowed. Client-only commands and vanilla campaign.* cheats are not supported.');
  }
  return v;
}
function sendError(res, error) { res.status(400).json({ error: error.message || 'Request failed.' }); }
function streamSave(res, name, extension) {
  const safeName = saveName(name);
  if (!['sav', 'json'].includes(extension)) return res.status(400).json({ error: 'Only .sav and .json files can be downloaded.' });
  const filename = `${safeName}.${extension}`;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const child = spawn('/usr/bin/sudo', ['-n', '/usr/local/sbin/bannerlord-dashboard-command', 'save-read', safeName, extension], {
    shell: false, env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 6000) stderr = stderr.slice(-6000); });
  child.on('error', error => { if (!res.headersSent) res.status(503).json({ error: error.message }); else res.destroy(error); });
  child.on('close', code => { if (code !== 0) { if (!res.headersSent) res.status(404).json({ error: stderr.trim() || 'Save file not found.' }); else res.destroy(new Error(stderr.trim() || 'Save download failed.')); } });
  child.stdout.pipe(res);
}

app.get('/api/health', async (_req, res) => res.json({ ok: true, dashboard: 'Bannerlord Server Dashboard' }));
app.get('/api/status', async (_req, res) => {
  try { const r = await runCoop(['status']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/doctor', async (_req, res) => {
  try { const r = await runCoop(['doctor'], { timeout: 90_000 }); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/version', async (_req, res) => {
  try { const r = await runCoop(['version']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/campaigns', async (_req, res) => {
  try { const r = await runCoop(['campaigns']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/mods', async (_req, res) => {
  try { const r = await runCoop(['mods']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/mod-catalog', async (_req, res) => {
  try { const r = await runCoop(['mod-catalog']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/backups', async (_req, res) => {
  try { const r = await runCoop(['backups']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/saves', async (_req, res) => {
  try {
    const r = await runCoop(['save-list']);
    const names = new Map();
    for (const filename of r.stdout.split('\n').map(v => v.trim()).filter(Boolean)) {
      const match = filename.match(/^(.+)\.(sav|json)$/i);
      if (!match) continue;
      let base;
      try { base = saveName(match[1]); } catch { continue; }
      const row = names.get(base) || { name: base, sav: false, json: false };
      row[match[2].toLowerCase()] = true;
      names.set(base, row);
    }
    res.json({ directory: SAVE_DIR, saves: [...names.values()].sort((a,b) => a.name.localeCompare(b.name)) });
  } catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/saves/:name/:extension', (req, res) => {
  try { streamSave(res, req.params.name, req.params.extension.toLowerCase()); }
  catch (e) { sendError(res, e); }
});
app.get('/api/cheat-mode', async (_req, res) => {
  try {
    const r = await runCoop(['cheat-mode']);
    res.json({ enabled: /(?:^|[^a-z])true(?:$|[^a-z])/i.test(r.stdout), raw: r.stdout });
  } catch (e) { res.status(503).json({ error: e.message }); }
});
app.post('/api/saves/import', upload.array('files', 2), async (req, res) => {
  let stagingDir = null;
  try {
    const files = req.files || [];
    if (files.length !== 2) throw new Error('Select exactly two files: one .sav and its matching .json session file.');
    const parsed = files.map(file => {
      const original = path.basename(file.originalname || '');
      const match = original.match(/^(.+)\.(sav|json)$/i);
      if (!match) throw new Error('Only .sav and .json files are accepted.');
      return { file, base: saveName(match[1]), extension: match[2].toLowerCase() };
    });
    if (parsed[0].base !== parsed[1].base || new Set(parsed.map(x => x.extension)).size !== 2) {
      throw new Error('The .sav and .json files must have the same filename (for example MyCampaign.sav and MyCampaign.json).');
    }
    stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bannerlord-dashboard-import-'));
    for (const item of parsed) {
      await fs.copyFile(item.file.path, path.join(stagingDir, `${item.base}.${item.extension}`));
    }
    const result = await runCoop(['save-import', stagingDir], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    res.json({ ok: true, output: result.stdout || 'Save import completed.' });
  } catch (e) { sendError(res, e); }
  finally {
    for (const file of req.files || []) await fs.rm(file.path, { force: true }).catch(() => {});
    if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
});
app.get('/api/world-settings', async (_req, res) => {
  try {
    const r = await runCoop(['world-settings-read'], { maxBuffer: 256 * 1024 });
    res.json(parseJson(r.stdout));
  } catch (e) { res.status(503).json({ error: e.message }); }
});
app.post('/api/world-settings', async (req, res) => {
  try {
    const settings = req.body?.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('A settings object is required.');
    const encoded = Buffer.from(JSON.stringify(settings), 'utf8').toString('base64');
    const r = await runCoop(['world-settings-write', encoded], { timeout: 30_000, maxBuffer: 64 * 1024 });
    res.json({ ok: true, ...parseJson(r.stdout) });
  } catch (e) { sendError(res, e); }
});
app.get('/api/config', async (_req, res) => {
  try { const r = await runCoop(['config']); res.json(redactSecrets(parseJson(r.stdout))); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/logs', async (_req, res) => {
  try { const r = await runCoop(['logs'], { timeout: 15_000 }); res.json({ logs: r.stdout.slice(-48_000) }); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/steam', async (_req, res) => {
  try { const r = await runCoop(['steam']); res.json(parseJson(r.stdout)); }
  catch (e) { res.status(503).json({ error: e.message }); }
});

app.post('/api/action/:action', async (req, res) => {
  const action = req.params.action;
  try {
    let args, timeout = 120_000;
    switch (action) {
      case 'start': args = ['start']; timeout = 240_000; break;
      case 'stop': args = ['stop']; timeout = 120_000; break;
      case 'restart': args = ['restart']; timeout = 240_000; break;
      case 'save': args = ['save']; timeout = 90_000; break;
      case 'cheat-mode': { if (typeof req.body.enabled !== 'boolean') throw new Error('enabled must be true or false.'); args = ['config-set', 'CHEAT_MODE', String(req.body.enabled), '--apply']; timeout = 300_000; break; }
      case 'cheat': args = ['cheat-console', cheatCommand(req.body.command)]; timeout = 60_000; break;
      case 'backup': args = ['backup']; if (req.body.note) args.push('--note', str(req.body.note, 'Backup note', 100)); break;
      case 'update': args = ['update']; timeout = 600_000; break;
      case 'rollback': args = ['rollback']; timeout = 300_000; break;
      case 'campaign-use': args = ['campaign', 'use', str(req.body.name, 'Campaign name', 80), '--yes']; timeout = 300_000; break;
      case 'campaign-new': args = ['campaign', 'new', str(req.body.name, 'Campaign name', 80), '--yes']; timeout = 300_000; break;
      case 'mod-add': args = ['mods', 'add', str(req.body.nameOrId, 'Mod name or Workshop ID', 180), '--yes']; timeout = 600_000; break;
      case 'mod-remove': args = ['mods', 'remove', str(req.body.nameOrId, 'Mod name or Workshop ID', 180), '--yes']; timeout = 600_000; break;
      case 'mod-update': args = ['mods', 'update', '--yes']; timeout = 600_000; break;
      case 'backup-restore': args = ['backup', 'restore', id(req.body.backupId, 'Backup ID'), '--yes']; timeout = 300_000; break;
      case 'ban': args = ['ban', steamId(req.body.steamId)]; if (req.body.name) args.push('--name', str(req.body.name, 'Player name', 80)); break;
      case 'unban': args = ['unban', steamId(req.body.steamId)]; break;
      case 'config-set': {
        const key = str(req.body.key, 'Setting key', 60).toUpperCase();
        if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /(PASSWORD|SECRET|TOKEN|CREDENTIAL|STEAM)/.test(key)) throw new Error('That setting cannot be changed from the dashboard.');
        const value = str(String(req.body.value ?? ''), 'Setting value', 200);
        args = ['config-set', key, value, '--apply']; timeout = 240_000; break;
      }
      case 'console': {
        const command = str(req.body.command, 'Console command', 240);
        const allowed = /^(status|players|save|help|say .{1,200}|kick [A-Za-z0-9_-]{1,40})$/i;
        if (!allowed.test(command)) throw new Error('Allowed console commands: status, players, save, help, say, kick.');
        args = ['console', command]; break;
      }
      default: return res.status(404).json({ error: 'Unknown action.' });
    }
    const result = await runCoop(args, { timeout });
    res.json({ ok: true, output: result.stdout || result.stderr || 'Command completed.' });
  } catch (e) { sendError(res, e); }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each save file must be 256 MB or smaller.' : `Upload failed: ${err.message}` });
  res.status(400).json({ error: err.message || 'Upload failed.' });
});
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir, { index: 'index.html', etag: true, maxAge: '5m' }));
app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));
app.listen(PORT, HOST, () => console.log(`Bannerlord dashboard listening on http://${HOST}:${PORT}`));

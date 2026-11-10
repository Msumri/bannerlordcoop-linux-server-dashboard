const fs = require('node:fs');
const path = require('node:path');

function readEnvFile(file) {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        let value = line.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        return [line.slice(0, index).trim(), value];
      }));
  } catch {
    return {};
  }
}

module.exports = {
  apps: [{
    name: 'bannerlord-dashboard',
    script: path.join(__dirname, 'server.js'),
    cwd: __dirname,
    interpreter: process.execPath,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    time: true,
    env: {
      ...readEnvFile('/etc/bannerlord-dashboard.env'),
      NODE_ENV: 'production'
    }
  }]
};

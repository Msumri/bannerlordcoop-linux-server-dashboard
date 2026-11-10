import fs from 'node:fs/promises';
import path from 'node:path';
import { parse, modify, applyEdits, printParseErrorCode } from 'jsonc-parser';

const CONFIG = process.env.BANNERLORD_MOD_CONFIG || '/srv/bannerlordcoop/server/server-data/mod-config.json';

const schema = {
  voice: {
    mapFullVolumeDistance: { type: 'number', min: 0, max: 500 },
    mapMaximumDistance: { type: 'number', min: 0, max: 1000 },
    sceneFullVolumeDistance: { type: 'number', min: 0, max: 500 },
    sceneMaximumDistance: { type: 'number', min: 0, max: 1000 }
  },
  difficulty: {
    playerReceivedDamage: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    playerTroopsReceivedDamage: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    combatAIDifficulty: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    recruitmentDifficulty: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    playerMapMovementSpeed: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    stealthAndDisguiseDifficulty: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    persuasionSuccessChance: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    clanMemberDeathChance: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    battleDeath: { type: 'enum', values: ['VeryEasy', 'Easy', 'Realistic'] },
    birthAndDeath: { type: 'boolean' },
    autoAllocateClanMemberPerks: { type: 'boolean' }
  },
  modOptions: {
    voiceEnabled: { type: 'boolean' },
    battleSize: { type: 'integer', min: 200, max: 5000 },
    fastForwardEnabled: { type: 'boolean' },
    autoPauseEnabled: { type: 'boolean' },
    clientsCanUseCheats: { type: 'boolean' },
    goldFoodInfluenceChangeInSettlements: { type: 'boolean' },
    goldFoodInfluenceChangeInBattles: { type: 'enum', values: ['Disabled', 'OneDayMax', 'Enabled'] },
    goldFoodInfluenceChangeForDisconnectedPlayers: { type: 'boolean' },
    blockAiWarDeclarationsOnOfflinePlayers: { type: 'boolean' },
    playerBattleAiJoinWindowHours: { type: 'number', min: 0, max: 168 },
    speedLimitWhilePlayersInBattle: { type: 'boolean' },
    ensureUnaffiliatedWanderers: { type: 'boolean' },
    wandererLimit: { type: 'integer', min: 0, max: 1000 },
    wandererLimitScalesWithPlayers: { type: 'boolean' },
    spawnRateWanderers: { type: 'number', min: 0, max: 100 },
    playerKingdomClanTierRequired: { type: 'integer', min: 0, max: 6 },
    coopClansEnabled: { type: 'boolean' },
    smithingStaminaRecoveryOutsideSettlements: { type: 'boolean' },
    smithingStaminaRecoveryMultiplier: { type: 'number', min: 0, max: 10 },
    maximumLootersMultiplier: { type: 'number', min: 0, max: 100 },
    looterPartySizeMultiplier: { type: 'number', min: 0, max: 100 },
    lordDefectionRetries: { type: 'enum', values: ['Vanilla', 'NeverExpire', 'AlwaysRetry'] },
    enableHeroExecutions: { type: 'boolean' },
    enablePlayerClanMemberExecutions: { type: 'boolean' },
    enablePlayerExecutions: { type: 'boolean' },
    showPlayerNameplates: { type: 'boolean' },
    playerWoundedBattleEntry: { type: 'boolean' },
    kingdomDecisionVoteTimeoutSeconds: { type: 'integer', min: 0, max: 3600 }
  }
};

function fail(message) { console.error(message); process.exit(1); }
function parseConfig(text) {
  const errors = [];
  const value = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) fail(`Config JSONC is invalid: ${errors.map(e => printParseErrorCode(e.error)).join(', ')}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Config root must be an object.');
  return value;
}
function validate(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('settings must be an object.');
  const updates = [];
  for (const [section, fields] of Object.entries(input)) {
    if (!schema[section] || !fields || typeof fields !== 'object' || Array.isArray(fields)) fail(`Unknown settings section: ${section}`);
    for (const [key, value] of Object.entries(fields)) {
      const rule = schema[section][key];
      if (!rule) fail(`Unknown setting: ${section}.${key}`);
      if (rule.type === 'boolean' && typeof value !== 'boolean') fail(`${key} must be true or false.`);
      if (rule.type === 'enum' && !rule.values.includes(value)) fail(`${key} must be one of: ${rule.values.join(', ')}.`);
      if (rule.type === 'number' || rule.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value) || (rule.type === 'integer' && !Number.isInteger(value))) fail(`${key} must be a valid ${rule.type}.`);
        if (key === 'battleSize' && value === current?.modOptions?.battleSize) {
          // Preserve the server's existing value, including legacy values outside the documented range.
        } else if (value < rule.min || value > rule.max) fail(`${key} must be between ${rule.min} and ${rule.max}.`);
      }
      updates.push({ path: [section, key], value });
    }
  }
  return updates;
}

const action = process.argv[2];
try {
  const targetStat = await fs.lstat(CONFIG);
  if (targetStat.isSymbolicLink() || !targetStat.isFile()) fail('The world settings path must be a regular file, not a symlink.');
  let text = await fs.readFile(CONFIG, 'utf8');
  const current = parseConfig(text);
  if (action === 'read') {
    process.stdout.write(JSON.stringify({ settings: current, configPath: CONFIG }));
  } else if (action === 'write') {
    const encoded = process.argv[3] || '';
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('Invalid settings payload.');
    const input = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const updates = validate(input, current);
    const originalBom = text.startsWith('\uFEFF');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    text = text.replace(/^\uFEFF/, '');
    for (const update of updates) {
      const edits = modify(text, update.path, update.value, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol }
      });
      text = applyEdits(text, edits);
    }
    parseConfig(text);
    const stat = await fs.stat(CONFIG);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(CONFIG, `${CONFIG}.dashboard-backup-${stamp}`);
    const temp = `${CONFIG}.dashboard-tmp-${process.pid}`;
    await fs.writeFile(temp, (originalBom ? '\uFEFF' : '') + text, { mode: stat.mode });
    await fs.chmod(temp, stat.mode);
    await fs.chown(temp, stat.uid, stat.gid);
    await fs.rename(temp, CONFIG);
    process.stdout.write(JSON.stringify({ ok: true, updated: updates.length, backup: `${CONFIG}.dashboard-backup-${stamp}`, apply: 'next_host_boot' }));
  } else fail('Expected read or write action.');
} catch (error) {
  fail(error.message || String(error));
}

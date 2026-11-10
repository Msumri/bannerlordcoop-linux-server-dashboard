import './style.css';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { tab: 'overview', status: null, logs: '', timer: null, busy: false, pending: null };
const labels = { overview: 'Overview', campaigns: 'Campaigns', saves: 'Save Manager', cheats: 'Cheats', mods: 'Mods', backups: 'Backups', world: 'World Settings', settings: 'Settings' };
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.style.borderColor = error ? '#704040' : '#44614e'; el.style.color = error ? '#efa6a0' : '#b8e2c5'; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3600); }
function notice(message, error = false) { const el = $('#notice'); el.textContent = message; el.classList.toggle('hidden', !message); el.classList.toggle('error', error); }
function confirmAction(title, text, run) { $('#dialog-title').textContent = title; $('#dialog-text').textContent = text; const dialog = $('#action-dialog'); dialog.showModal(); state.pending = run; }
$('#dialog-confirm').addEventListener('click', async e => { e.preventDefault(); $('#action-dialog').close(); if (!state.pending) return; const fn = state.pending; state.pending = null; await fn(); });
function askText(title, label, placeholder, action, field) { const value = prompt(`${title}\n${label}`, placeholder || ''); if (value === null || !value.trim()) return; confirmAction(title, `Proceed with: ${value.trim()}?`, () => doAction(action, { [field]: value.trim() })); }
async function doAction(action, body = {}) { if (state.busy) return; state.busy = true; notice('Working… Some operations (start, updates, mod changes) can take several minutes.'); try { const result = await api(`/api/action/${action}`, { method: 'POST', body: JSON.stringify(body) }); toast(result.output || 'Action completed.'); notice(''); await refreshAll(); } catch (e) { notice(e.message, true); toast(e.message, true); } finally { state.busy = false; } }
function bindActionButtons() { $$('[data-action]').forEach(b => b.addEventListener('click', () => { const a = b.dataset.action; const names = { start: ['Start server', 'Start the Bannerlord dedicated server?', 'start'], stop: ['Stop server', 'Stop the server cleanly and save the campaign?', 'stop'], restart: ['Restart server', 'The server will shut down cleanly and start again.', 'restart'], save: ['Save campaign', 'Force a campaign save now?', 'save'], backup: ['Create backup', 'Create a backup of saves and configuration?', 'backup'], update: ['Update server', 'Install the latest Coop build. A backup is made first; players may need to update their clients.', 'update'], rollback: ['Rollback server', 'Return to the previous installed Coop build?', 'rollback'], 'mod-update': ['Update mods', 'Update installed Workshop mods. The manager backs up and restarts the server.', 'mod-update'] }; const [t, d, action] = names[a] || []; confirmAction(t, d, () => doAction(action)); })); }
function setTab(tab) { state.tab = tab; $$('.tab-panel').forEach(p => p.classList.add('hidden')); $(`#tab-${tab}`).classList.remove('hidden'); $$('.nav').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); $('#page-title').textContent = labels[tab]; if (tab === 'campaigns') loadCampaigns(); if (tab === 'saves') loadSaves(); if (tab === 'cheats') loadCheats(); if (tab === 'mods') loadMods(); if (tab === 'backups') loadBackups(); if (tab === 'world') loadWorldSettings(); if (tab === 'settings') loadSettings(); }
$$('.nav').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function findValue(obj, keys) { if (!obj || typeof obj !== 'object') return undefined; for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k]; for (const v of Object.values(obj)) if (v && typeof v === 'object') { const found = findValue(v, keys); if (found !== undefined) return found; } }
function showStatus(s) { state.status = s; const raw = String(findValue(s, ['status','state','phase','server_status']) || 'unknown').toLowerCase(); const online = /running|online|serving|started/.test(raw); const offline = /stopped|offline|down|not.running/.test(raw); const pill = $('#status-pill'); pill.textContent = online ? '● ONLINE' : offline ? '● OFFLINE' : raw.toUpperCase(); pill.className = `status-pill ${online ? 'online' : offline ? 'offline' : 'unknown'}`; $('#metric-status').textContent = online ? 'Online' : offline ? 'Offline' : raw.replaceAll('_',' '); $('#server-subtitle').textContent = findValue(s, ['address','connect_address','endpoint']) || 'Dedicated server status'; $('#game-port').textContent = findValue(s, ['game_port','port']) || '4200 / UDP'; $('#campaign-name').textContent = findValue(s, ['save_name','campaign','campaign_name']) || '—'; $('#server-name').textContent = findValue(s, ['label','server_label','name']) || 'Bannerlord Co-op'; $('#build-name').textContent = findValue(s, ['coop_build','build','version']) || '—'; $('#metric-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`; }
async function loadStatus() { try { showStatus(await api('/api/status')); } catch (e) { $('#status-pill').textContent = 'UNAVAILABLE'; $('#status-pill').className = 'status-pill offline'; $('#metric-status').textContent = 'Unavailable'; notice(e.message, true); } }
async function loadLogs() { try { const r = await api('/api/logs'); if (r.logs !== state.logs) { state.logs = r.logs || ''; const el = $('#logs'); const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60; el.textContent = state.logs || 'No log output yet.'; if (nearBottom) el.scrollTop = el.scrollHeight; } } catch (e) { $('#logs').textContent = e.message; } }
async function loadSteam() { try { const d = await api('/api/steam'); $('#steam-status').textContent = String(findValue(d, ['status','authenticated','logged_in']) ?? 'Available'); } catch { $('#steam-status').textContent = 'Unknown'; } }
async function refreshAll() { await Promise.all([loadStatus(), loadLogs(), loadSteam()]); }
$('#refresh').addEventListener('click', refreshAll); $('#clear-logs').addEventListener('click', () => { $('#logs').textContent = 'View cleared. New output will appear on the next refresh.'; });
$('#console-form').addEventListener('submit', e => { e.preventDefault(); const input = $('#console-command'); const command = input.value.trim(); if (!command) return; confirmAction('Send console command', `Send this command to the game server?\n\n${command}`, async () => { await doAction('console', { command }); input.value = ''; }); });
$('#run-doctor').addEventListener('click', async () => { $('#doctor-result').textContent = 'Running diagnostics…'; try { const d = await api('/api/doctor'); $('#doctor-result').textContent = JSON.stringify(d, null, 2); } catch (e) { $('#doctor-result').textContent = e.message; } });
async function loadCampaigns() { const el = $('#campaign-list'); el.textContent = 'Loading campaigns…'; try { const d = await api('/api/campaigns'); const list = Array.isArray(d) ? d : (d.campaigns || d.saves || d.items || []); if (!list.length) { el.innerHTML = '<div class="empty">No campaign entries returned. Check the manager CLI output.</div>'; return; } el.innerHTML = list.map(c => { const name = typeof c === 'string' ? c : (c.name || c.save_name || c.id || 'Campaign'); const active = !!(c.active || c.current || c.hosted); return `<div class="row-item"><div><b>${esc(name)}</b><small>${active ? 'Currently hosted' : 'Saved campaign'}</small></div><div class="row-actions">${active ? '<span class="status-pill online">ACTIVE</span>' : `<button class="mini-btn" data-campaign="${escAttr(name)}">Host campaign</button>`}</div></div>`; }).join(''); $$('[data-campaign]').forEach(b => b.addEventListener('click', () => confirmAction('Switch campaign', `Switch to ${b.dataset.campaign}? The manager creates a backup and restarts the server.`, () => doAction('campaign-use', { name: b.dataset.campaign })))); } catch (e) { el.textContent = e.message; } }
$('#new-campaign').addEventListener('click', () => askText('Create campaign', 'Enter a new campaign name:', 'New Campaign', 'campaign-new', 'name'));
async function loadSaves() {
  const el = $('#save-list'); el.textContent = 'Loading campaign save files…';
  try {
    const d = await api('/api/saves'); const list = d.saves || [];
    if (!list.length) { el.innerHTML = '<div class="empty">No .sav or .json files found in the server save directory.</div>'; return; }
    el.innerHTML = list.map(save => `<div class="row-item"><div><b>${esc(save.name)}</b><small>${save.sav ? 'World save present' : 'Missing .sav'} · ${save.json ? 'Co-op session file present' : 'Missing .json'}</small></div><div class="row-actions">${save.sav ? `<a class="mini-btn" href="/api/saves/${encodeURIComponent(save.name)}/sav">Download .sav</a>` : ''}${save.json ? `<a class="mini-btn" href="/api/saves/${encodeURIComponent(save.name)}/json">Download .json</a>` : ''}</div></div>`).join('');
  } catch (e) { el.textContent = e.message; }
}
$('#refresh-saves').addEventListener('click', loadSaves);
$('#save-upload-form').addEventListener('submit', async e => {
  e.preventDefault(); const input = $('#save-files'); const files = [...(input.files || [])];
  if (files.length !== 2) { toast('Select exactly one .sav and one matching .json file.', true); return; }
  const sav = files.find(f => f.name.toLowerCase().endsWith('.sav'));
  const json = files.find(f => f.name.toLowerCase().endsWith('.json'));
  if (!sav || !json || sav.name.slice(0,-4).toLowerCase() !== json.name.slice(0,-5).toLowerCase()) { toast('The .sav and .json filenames must match.', true); return; }
  confirmAction('Import campaign save', `Import ${sav.name} and ${json.name}? The manager will reject an existing campaign name rather than overwrite it.`, async () => {
    const form = new FormData(); files.forEach(file => form.append('files', file));
    state.busy = true; notice('Importing save pair… This may take a few minutes.');
    try { const result = await api('/api/saves/import', { method:'POST', body:form }); toast(result.output || 'Save imported.'); notice(''); input.value=''; await loadSaves(); await loadCampaigns(); }
    catch (err) { notice(err.message, true); toast(err.message, true); }
    finally { state.busy = false; }
  });
});
const featuredCheats = [
  ['coop.debug.players.list','Lists registered co-op players.','Players','Both','Inspect'],
  ['coop.debug.hero.list [name_prefix]','Lists registered heroes, optionally filtered by display-name prefix.','Heroes','Both','Inspect'],
  ['coop.debug.town.list_towns','Lists towns for co-op debugging.','Towns','Server','Inspect'],
  ['coop.debug.village.list','Lists relevant village state.','Villages','Server','Inspect'],
  ['coop.debug.kingdom.list','Lists campaign kingdoms.','Kingdoms','Server','Inspect'],
  ['coop.debug.clan.list','Lists campaign clans.','Clans','Server','Inspect'],
  ['coop.debug.companions.list_wanderers','Lists available wanderer heroes.','Companions','Server','Inspect'],
  ['coop.unstuck [player]','Unsticks a connected player; provide a controller ID or hero name on the server.','Player','Both','Gameplay'],
  ['coop.debug.map_event.leave_settlement <controller_id>','Makes a player leave a settlement.','Map events','Server','Gameplay'],
  ['coop.debug.mobile_party.siege_buff <party_id>','Applies the siege buff to a mobile party.','Mobile parties','Server','Gameplay'],
  ['coop.debug.clan.add_renown <clan_id> <renown>','Adds renown to a registered clan.','Clans','Server','Gameplay'],
  ['coop.debug.clan.add_influence <clan_id> <amount>','Adds influence to a registered clan.','Clans','Server','Gameplay'],
  ['coop.debug.hero.set_gold <hero_name> <gold>','Sets gold for every hero with an exact display name.','Heroes','Server','Gameplay'],
  ['coop.debug.hero.set_relation <hero1_id> <hero2_id> <value>','Sets the base relation between two registered heroes.','Heroes','Server','Gameplay'],
  ['coop.debug.hero_developer.add_skill_xp <hero_name_or_id> <skill_name> <xp_amount>','Adds skill experience to a hero.','Hero development','Server','Gameplay'],
  ['coop.debug.hero_developer.add_attribute_points <hero_name_or_id> <point_count>','Adds attribute points to a hero.','Hero development','Server','Gameplay'],
  ['coop.debug.hero_developer.add_focus_points <hero_name_or_id> <point_count>','Adds focus points to a hero.','Hero development','Server','Gameplay'],
  ['coop.debug.hero_developer.reset_skills <hero_name_or_id>','Resets a hero’s skills.','Hero development','Server','Gameplay'],
  ['coop.debug.crafting.give_supplies <hero_name>','Gives smithing supplies to a hero.','Smithing','Server','Gameplay'],
  ['coop.debug.kingdom.create <leader_hero_name> <kingdom_name>','Creates a kingdom for a clan leader.','Kingdoms','Server','Gameplay'],
  ['coop.debug.kingdom.declare_war <faction1_id> <faction2_id>','Declares war between two factions.','Kingdoms','Both','Gameplay'],
  ['coop.debug.kingdom.make_peace <faction1_id> <faction2_id>','Makes peace between two factions.','Kingdoms','Both','Gameplay'],
  ['coop.debug.settlements.set_owner_clan <settlementNameOrId> <heroId> [transfer]','Sets a settlement’s owner clan.','Settlements','Server','Gameplay'],
  ['coop.debug.clan.remove_companion <hero_id>','Removes a registered companion from a clan.','Clans','Server','Gameplay'],
  ['coop.debug.romance.start <player_hero_id> <npc_hero_id>','Starts courtship between a player and NPC.','Romance','Server','Gameplay'],
  ['coop.debug.romance.compatible <player_hero_id> <npc_hero_id>','Marks a romance pair as compatible.','Romance','Server','Gameplay'],
  ['coop.debug.romance.agree <player_hero_id> <npc_hero_id>','Marks a romance pair as agreed on marriage.','Romance','Server','Gameplay'],
  ['coop.debug.romance.marry <player_hero_id> <npc_hero_id>','Marries a player hero and NPC hero.','Romance','Server','Gameplay']
].map(([command,description,category,side,type]) => ({command,description,category,side,type}));
function drawCheats() {
  const q = ($('#cheat-search')?.value || '').trim().toLowerCase();
  const list = featuredCheats.filter(c => `${c.command} ${c.description} ${c.category} ${c.side}`.toLowerCase().includes(q));
  $('#cheat-count').textContent = `${list.length} commands`;
  $('#cheat-list').innerHTML = list.map((c,i) => `<article class="cheat-item"><code>${esc(c.command)}</code><p>${esc(c.description)}</p><div class="cheat-meta"><small>${esc(c.category.toUpperCase())} · ${esc(c.side.toUpperCase())}</small><button data-use-cheat="${i}">Use command</button></div></article>`).join('') || '<div class="empty">No commands match your search.</div>';
  $$('#cheat-list [data-use-cheat]').forEach(b => b.addEventListener('click', () => { const c=list[Number(b.dataset.useCheat)]; $('#cheat-command').value=c.command.split(/\s+(?=<|\[)/)[0]; $('#cheat-command').placeholder=c.command; $('#cheat-command').focus(); }));
}
async function loadCheats() {
  drawCheats(); const button=$('#cheat-mode-toggle'), desc=$('#cheat-mode-description');
  try { const d=await api('/api/cheat-mode'); button.disabled=false; button.textContent=d.enabled?'Disable native cheats':'Enable native cheats'; button.dataset.enabled=String(d.enabled); desc.textContent=d.enabled?'CHEAT_MODE is enabled. This setting requires a server restart when changed.':'CHEAT_MODE is disabled. Coop debug commands may still be available; native game cheats are separate.'; }
  catch(e) { button.disabled=true; button.textContent='Unavailable'; desc.textContent=e.message; }
}
$('#cheat-search').addEventListener('input', drawCheats);
$('#cheat-mode-toggle').addEventListener('click', () => { const enabled=$('#cheat-mode-toggle').dataset.enabled==='true'; confirmAction(enabled?'Disable native cheat mode':'Enable native cheat mode', 'The manager applies CHEAT_MODE through coop config and may restart the dedicated server. The official Coop directory notes that vanilla campaign.* cheats are disabled.', async () => { await doAction('cheat-mode',{enabled:!enabled}); await loadCheats(); }); });
$('#cheat-form').addEventListener('submit', e => { e.preventDefault(); const command=$('#cheat-command').value.trim(); if(!command) return; confirmAction('Run server cheat', `Execute this Coop debug command on the server?\n\n${command}`, async () => { state.busy=true; $('#cheat-output').textContent='Running command…'; try { const result=await api('/api/action/cheat',{method:'POST',body:JSON.stringify({command})}); $('#cheat-output').textContent=result.output || 'Command sent.'; toast('Command sent.'); } catch(err) { $('#cheat-output').textContent=err.message; toast(err.message,true); } finally { state.busy=false; } }); });
async function loadMods() { const el = $('#mod-list'); el.textContent = 'Loading mods…'; try { const d = await api('/api/mods'); const list = Array.isArray(d) ? d : (d.mods || d.items || []); if (!list.length) { el.innerHTML = '<div class="empty">No installed mod details returned.</div>'; return; } el.innerHTML = list.map(m => { const name = typeof m === 'string' ? m : (m.name || m.title || m.id || 'Mod'); const mid = typeof m === 'string' ? m : (m.id || m.workshop_id || name); return `<div class="row-item"><div><b>${esc(name)}</b><small>${esc(String(mid))}</small></div><div class="row-actions"><button class="mini-btn warn" data-remove-mod="${escAttr(mid)}">Remove</button></div></div>`; }).join(''); $$('[data-remove-mod]').forEach(b => b.addEventListener('click', () => confirmAction('Remove mod', `Remove ${b.dataset.removeMod}? The manager backs up and restarts the server.`, () => doAction('mod-remove', { nameOrId: b.dataset.removeMod })))); } catch (e) { el.textContent = e.message; } }
$('#add-mod').addEventListener('click', () => askText('Add Workshop mod', 'Enter a catalog name, Workshop ID, or URL:', '', 'mod-add', 'nameOrId'));
async function loadBackups() { const el = $('#backup-list'); el.textContent = 'Loading backups…'; try { const d = await api('/api/backups'); const list = Array.isArray(d) ? d : (d.backups || d.items || []); if (!list.length) { el.innerHTML = '<div class="empty">No backups found.</div>'; return; } el.innerHTML = list.map(b => { const bid = typeof b === 'string' ? b : (b.id || b.backup_id || b.file || ''); const detail = typeof b === 'string' ? '' : (b.created_at || b.date || b.note || ''); return `<div class="row-item"><div><b>${esc(bid)}</b><small>${esc(String(detail))}</small></div><div class="row-actions"><button class="mini-btn warn" data-restore="${escAttr(bid)}">Restore</button></div></div>`; }).join(''); $$('[data-restore]').forEach(b => b.addEventListener('click', () => confirmAction('Restore backup', `Restore backup ${b.dataset.restore}? Current data will be protected by the manager's restore procedure, but the campaign will be rolled back.`, () => doAction('backup-restore', { backupId: b.dataset.restore })))); } catch (e) { el.textContent = e.message; } }
async function loadSettings() { const el = $('#settings-list'); el.textContent = 'Loading settings…'; try { const d = await api('/api/config'); const list = Array.isArray(d) ? d : (d.settings || d.config || d.items || []); if (!list.length) { el.innerHTML = `<div class="empty">${esc(JSON.stringify(d))}</div>`; } else { el.innerHTML = list.map(s => { const key = typeof s === 'string' ? s : (s.key || s.name || ''); const val = typeof s === 'string' ? '' : (s.value ?? ''); return `<div class="setting-row"><label>${esc(key)}</label><input data-setting-value="${escAttr(key)}" value="${escAttr(String(val))}"><button class="mini-btn" data-setting-save="${escAttr(key)}">Apply</button></div>`; }).join(''); $$('[data-setting-save]').forEach(b => b.addEventListener('click', () => { const key = b.dataset.settingSave; const value = $(`[data-setting-value="${CSS.escape(key)}"]`).value; confirmAction('Apply configuration', `Set ${key} to ${value} and apply it? Some settings restart the server.`, () => doAction('config-set', { key, value })); })); } const v = await api('/api/version'); $('#version-info').textContent = JSON.stringify(v, null, 2); } catch (e) { el.textContent = e.message; } }

const worldGroups = [
  { title: 'Campaign difficulty', section: 'difficulty', fields: [
    ['playerReceivedDamage','enum','Player damage taken','How much damage the player receives.'],
    ['playerTroopsReceivedDamage','enum','Player troop damage taken','How much damage the player’s troops receive.'],
    ['combatAIDifficulty','enum','Combat AI difficulty','Controls the combat AI challenge level.'],
    ['recruitmentDifficulty','enum','Recruitment difficulty','Changes the number of troops offered for recruitment.'],
    ['playerMapMovementSpeed','enum','Player map movement speed','Affects the player party’s campaign-map movement speed.'],
    ['stealthAndDisguiseDifficulty','enum','Stealth and disguise difficulty','Controls stealth/disguise challenge.'],
    ['persuasionSuccessChance','enum','Persuasion success chance','Changes persuasion success chance.'],
    ['clanMemberDeathChance','enum','Clan member death chance','Controls battle death risk for clan members.'],
    ['battleDeath','enum','Battle death','Controls hero battle-death rules.'],
    ['birthAndDeath','boolean','Birth and aging','Enables births, aging, and natural deaths.'],
    ['autoAllocateClanMemberPerks','boolean','Auto-allocate clan perks','Automatically allocates perks for clan members.']
  ]},
  { title: 'Co-op and player rules', section: 'modOptions', fields: [
    ['coopClansEnabled','boolean','Co-op clans','Enable co-op clan features.'],
    ['voiceEnabled','boolean','Enable voice chat','Voice enablement can be session-only depending on the mod; this file setting is retained here.'],
    ['playerKingdomClanTierRequired','integer','Clan tier to create a kingdom','Required clan tier for a player kingdom (0–6).'],
    ['clientsCanUseCheats','boolean','Allow clients to use cheats','Allows connected clients to use supported cheat features.'],
    ['showPlayerNameplates','boolean','Show player nameplates','Display player nameplates in-game.'],
    ['playerWoundedBattleEntry','boolean','Allow wounded players into battles','Controls whether wounded players can enter battles.']
  ]},
  { title: 'Wanderers and parties', section: 'modOptions', fields: [
    ['ensureUnaffiliatedWanderers','boolean','Maintain unaffiliated wanderers','When enabled, wandererLimit targets unaffiliated wanderers; recruited wanderers do not count.'],
    ['wandererLimit','integer','Wanderer limit','Target count/cap for wanderers when scaling is disabled.'],
    ['wandererLimitScalesWithPlayers','boolean','Scale wanderers with players','When enabled, the mod calculates the limit from player clan tiers and overrides the two settings above.'],
    ['spawnRateWanderers','number','Wanderer spawn rate','Vanilla is about 1 per day. Values below 1 prevent additional wanderer spawns.'],
    ['maximumLootersMultiplier','number','Maximum looter parties multiplier','Higher values can increase looter/bandit party counts and server load.'],
    ['looterPartySizeMultiplier','number','Looter party size multiplier','Applies to newly created parties; existing parties are unchanged.']
  ]},
  { title: 'Battles and campaign time', section: 'modOptions', fields: [
    ['battleSize','integer','Battle size','The Coop config documents 200–1000. Your current value may be higher; an unchanged existing value is preserved.'],
    ['playerBattleAiJoinWindowHours','number','AI join window (hours)','Set to 0 to prevent AI parties joining player battles.'],
    ['speedLimitWhilePlayersInBattle','boolean','Limit campaign speed during player battles','Prevents campaign time from advancing too quickly while players are in battle.'],
    ['fastForwardEnabled','boolean','Enable fast-forward','Allow campaign fast-forward.'],
    ['autoPauseEnabled','boolean','Enable auto-pause','Allow the mod to automatically pause campaign time.'],
    ['kingdomDecisionVoteTimeoutSeconds','integer','Kingdom vote timeout (seconds)','Vote timeout; values at or below 0 are reset to 60 by the mod.']
  ]},
  { title: 'Economy and smithing', section: 'modOptions', fields: [
    ['goldFoodInfluenceChangeInSettlements','boolean','Gold/food influence changes in settlements','Enable settlement influence changes from gold and food.'],
    ['goldFoodInfluenceChangeInBattles','enum','Gold/food influence changes in battles','Controls gold/food influence changes during battles.'],
    ['goldFoodInfluenceChangeForDisconnectedPlayers','boolean','Apply changes to disconnected players','Whether disconnected players receive gold/food influence changes.'],
    ['blockAiWarDeclarationsOnOfflinePlayers','boolean','Block AI wars against offline players','Prevents AI kingdoms declaring war on kingdoms with offline players.'],
    ['smithingStaminaRecoveryOutsideSettlements','boolean','Recover smithing stamina outside settlements','Allow smithing stamina recovery outside settlements.'],
    ['smithingStaminaRecoveryMultiplier','number','Smithing stamina recovery multiplier','Lower values reduce recovery; the mod notes values below 0.1 have no further effect.'],
    ['lordDefectionRetries','enum','Lord defection retries','Controls how the mod retries lord defection decisions.'],
    ['enableHeroExecutions','boolean','Enable hero executions','Master switch for hero execution settings.'],
    ['enablePlayerClanMemberExecutions','boolean','Allow executions of player clan members','Only applies when hero executions are enabled.'],
    ['enablePlayerExecutions','boolean','Allow executions of players','Only applies when hero executions are enabled.']
  ]},
  { title: 'Voice chat distances', section: 'voice', fields: [
    ['mapFullVolumeDistance','number','Map full-volume distance','Distance at which map voice chat is at full volume.'],
    ['mapMaximumDistance','number','Map maximum distance','Maximum range for map voice chat.'],
    ['sceneFullVolumeDistance','number','Scene full-volume distance','Distance at which scene voice chat is at full volume.'],
    ['sceneMaximumDistance','number','Scene maximum distance','Maximum range for scene voice chat.']
  ]}
];
const worldEnums = {
  difficulty: ['VeryEasy','Easy','Realistic'],
  goldFoodInfluenceChangeInBattles: ['Disabled','OneDayMax','Enabled'],
  lordDefectionRetries: ['Vanilla','NeverExpire','AlwaysRetry']
};
let worldSettings = null;
function worldControl(section, field) {
  const [key, type, label, description] = field;
  const value = worldSettings?.[section]?.[key];
  const id = `world-${section}-${key}`;
  let control = '';
  if (type === 'boolean') {
    control = `<label class="world-toggle"><input id="${id}" type="checkbox" data-world-section="${section}" data-world-key="${key}" ${value ? 'checked' : ''}><span>${value ? 'Enabled' : 'Disabled'}</span></label>`;
  } else if (type === 'enum') {
    const options = (worldEnums[key] || worldEnums[section] || []).map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('');
    control = `<select id="${id}" data-world-section="${section}" data-world-key="${key}">${options}</select>`;
  } else {
    const step = type === 'integer' ? '1' : '0.1';
    control = `<input id="${id}" type="number" step="${step}" data-world-section="${section}" data-world-key="${key}" value="${escAttr(value ?? '')}">`;
  }
  return `<div class="world-setting"><div class="world-setting-copy"><label for="${id}">${esc(label)}</label><small>${esc(description)}</small></div><div class="world-setting-control">${control}</div></div>`;
}
function renderWorldSettings() {
  const el = $('#world-settings-list');
  el.innerHTML = worldGroups.map(group => `<section class="world-group"><div class="world-group-heading"><h3>${esc(group.title)}</h3><span>${group.fields.length} SETTINGS</span></div><div class="world-group-list">${group.fields.map(field => worldControl(group.section, field)).join('')}</div></section>`).join('');
  $$('[data-world-section]').forEach(control => {
    if (control.type === 'checkbox') control.addEventListener('change', () => { const span = control.parentElement.querySelector('span'); span.textContent = control.checked ? 'Enabled' : 'Disabled'; });
  });
}
async function loadWorldSettings() {
  const el = $('#world-settings-list');
  el.innerHTML = '<div class="empty">Loading world settings…</div>';
  try {
    const data = await api('/api/world-settings');
    worldSettings = data.settings || data;
    renderWorldSettings();
  } catch (error) {
    el.innerHTML = `<div class="notice error">${esc(error.message)}</div>`;
  }
}
$('#world-refresh').addEventListener('click', loadWorldSettings);
$('#world-save').addEventListener('click', () => {
  if (!worldSettings) return toast('World settings have not loaded.', true);
  const updated = {};
  for (const group of worldGroups) {
    updated[group.section] ||= {};
    for (const [key, type] of group.fields.map(([key,type]) => [key,type])) {
      const control = $(`[data-world-section="${group.section}"][data-world-key="${key}"]`);
      if (!control) continue;
      let value;
      if (type === 'boolean') value = control.checked;
      else if (type === 'number' || type === 'integer') value = Number(control.value);
      else value = control.value;
      updated[group.section][key] = value;
    }
  }
  confirmAction('Save world settings', 'Save these Coop mod settings to mod-config.json? A timestamped backup will be created. The settings take effect at the next host boot; this does not restart the server.', async () => {
    try {
      const result = await api('/api/world-settings', { method: 'POST', body: JSON.stringify({ settings: updated }) });
      toast(`Saved ${result.updated} settings. Backup created.`);
      await loadWorldSettings();
    } catch (error) { notice(error.message, true); toast(error.message, true); }
  });
});

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s) { return esc(s); }
bindActionButtons(); refreshAll(); state.timer = setInterval(() => { if (document.visibilityState === 'visible') { loadStatus(); loadLogs(); } }, 5000);

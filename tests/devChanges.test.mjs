// Dev-change reader: pending detection, formatting, and admin notification.
//
// Scenarios A-H from the spec:
//   A  first run, no state, 3 entries  -> one aggregated notice, state written
//   B  restart with nothing new       -> nothing sent
//   C  one new entry                  -> single-change notice
//   D  two new entries                -> aggregated notice
//   E  entry with 20 files            -> 8 shown + "… and 12 more"
//   F  toggle off                     -> nothing sent, but state still advances
//   G  dev-changes.json missing       -> warn, no crash
//   H  two admins                     -> both receive it
//
// dev-changes.json and data/lastNotifiedChangeId.json are both backed up and
// restored, so nothing here can leave the repo or the live state changed.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const dataDir = path.join(repoRoot, 'data');
const devChangesFile = path.join(repoRoot, 'dev-changes.json');
const stateFile = path.join(dataDir, 'lastNotifiedChangeId.json');
const backupDir = path.join(os.tmpdir(), 'devchanges-backup');

const devChangesOriginal = fs.readFileSync(devChangesFile, 'utf8');
const stateOriginal = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreAll = () => {
  fs.writeFileSync(devChangesFile, devChangesOriginal);
  if (stateOriginal === null) fs.rmSync(stateFile, { force: true });
  else fs.writeFileSync(stateFile, stateOriginal);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, dataDir, { recursive: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
};

let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra && !cond ? ' :: ' + String(extra).slice(0, 300) : ''));
  if (!cond) fails++;
}

const { toSmallCaps } = await import('../src/utils/smallCaps.js');
const SMALL_TO_PLAIN = new Map();
for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
  const mapped = toSmallCaps(ch);
  if (mapped && mapped.length === 1 && mapped !== ch) SMALL_TO_PLAIN.set(mapped, ch);
}
const dec = (s) => String(s).split('').map((c) => SMALL_TO_PLAIN.get(c) ?? c).join('');
// dec() always yields lower case, so phrase checks must be case-insensitive.
const hasPhrase = (haystack, phrase) => dec(haystack).toLowerCase().includes(phrase.toLowerCase());

const svc = await import('../src/services/devChangesService.js');
const fmt = await import('../src/utils/devChangeFormatter.js');
const { notifyPendingDevChanges } = await import('../src/services/devChangeNotifier.js');
const settingsService = (await import('../src/services/settingsService.js')).default;

const entry = (n, over = {}) => ({
  id: `chg-2026-10-0${n}T10-00-00`,
  timestamp: `2026-10-0${n}T10:00:00Z`,
  agent: 'Cline',
  promptSummary: `Prompt ${n}`,
  changes: [`change ${n}a`, `change ${n}b`],
  files: [`src/file${n}.js`],
  type: 'feature',
  versionSuggested: '1.1.1',
  ...over
});

function writeEntries(list) {
  fs.writeFileSync(devChangesFile, JSON.stringify({ entries: list }, null, 2), 'utf8');
}

function clearState() {
  fs.rmSync(stateFile, { force: true });
}

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, text: String(content?.text ?? '') });
      if (content?.edit) return { key: content.edit };
      return { key: { id: 'K' + sent.length } };
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => true
  };
}

const originalAdmins = (await import('../src/config/config.js')).default.adminJids;

try {
  // ------------------------------------------------------------------
  // A. First run, no state, three entries -> one aggregated notice
  // ------------------------------------------------------------------
  writeEntries([entry(3), entry(2), entry(1)]);
  clearState();
  check('A: state file absent', !fs.existsSync(stateFile));
  check('A: loadNotifiedState defaults to null id', svc.loadNotifiedState().lastNotifiedId === null);
  check('A: getPendingChanges returns all 3', svc.getPendingChanges().length === 3, String(svc.getPendingChanges().length));
  check('A: pending is newest first', svc.getPendingChanges()[0].id === entry(3).id);

  let sock = makeSock();
  let res = await notifyPendingDevChanges(sock);
  check('A: one message per admin', sock.sent.length === originalAdmins.length, String(sock.sent.length));
  const aggText = sock.sent[0]?.text || '';
  check('A: aggregated (not single)', aggText.includes('(3 '), aggText.slice(0, 160));
  check('A: lists each prompt summary', ['Prompt 3', 'Prompt 2', 'Prompt 1'].every((s) => hasPhrase(aggText, s)));
  check('A: mentions files changed', hasPhrase(aggText, 'files changed'));
  check('A: state file now written', fs.existsSync(stateFile));
  check('A: state holds the newest id', svc.loadNotifiedState().lastNotifiedId === entry(3).id, svc.loadNotifiedState().lastNotifiedId);
  check('A: state records a timestamp', typeof svc.loadNotifiedState().lastNotifiedAt === 'string');

  // ------------------------------------------------------------------
  // B. Restart with nothing new -> nothing sent
  // ------------------------------------------------------------------
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('B: no messages on restart', sock.sent.length === 0, String(sock.sent.length));
  check('B: reports zero pending', res.pending === 0);
  check('B: state unchanged', svc.loadNotifiedState().lastNotifiedId === entry(3).id);

  // ------------------------------------------------------------------
  // C. One new entry -> single-change notice
  // ------------------------------------------------------------------
  writeEntries([entry(4), entry(3), entry(2), entry(1)]);
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('C: one message sent', sock.sent.length === originalAdmins.length);
  check('C: exactly one pending entry', res.pending === 1);
  const singleText = sock.sent[0]?.text || '';
  const plainSingle = dec(singleText);
  check('C: single format, not aggregated', !hasPhrase(singleText, 'Code Update ('), singleText.slice(0, 120));
  check('C: shows the change id verbatim', singleText.includes(entry(4).id));
  check('C: shows the agent', hasPhrase(singleText, 'Cline'));
  check('C: shows the prompt summary', hasPhrase(singleText, 'Prompt 4'));
  check('C: lists change bullets', singleText.includes('• ' + toSmallCaps('change 4a')));
  check('C: lists files section', hasPhrase(singleText, 'Files'));
  check('C: state advanced to the new id', svc.loadNotifiedState().lastNotifiedId === entry(4).id);

  // ------------------------------------------------------------------
  // D. Two new entries -> aggregated notice mentioning 2
  // ------------------------------------------------------------------
  writeEntries([entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)]);
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('D: two pending', res.pending === 2);
  check('D: aggregated flag set', res.pending > 1);
  check('D: header mentions 2 changes', sock.sent[0].text.includes('(2 '), sock.sent[0].text.slice(0, 160));
  check('D: state advanced', svc.loadNotifiedState().lastNotifiedId === entry(6).id);

  // ------------------------------------------------------------------
  // E. Large file list is truncated
  // ------------------------------------------------------------------
  const manyFiles = Array.from({ length: 20 }, (_, i) => `src/gen/file${i}.js`);
  writeEntries([entry(7, { files: manyFiles }), entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)]);
  sock = makeSock();
  await notifyPendingDevChanges(sock);
  const manyText = dec(sock.sent[0].text);
  check('E: lists 8 files', manyFiles.slice(0, 8).every((f) => manyText.includes(f)), 'missing an early file');
  check('E: omits the 9th file', !manyText.includes('src/gen/file8.js'));
  check('E: shows the overflow count', manyText.includes('12') && manyText.includes('more'), 'no overflow marker');
  check('E: states the total', manyText.includes('(20)'), 'total missing');

  // Aggregated form truncates summaries past 5.
  const many = Array.from({ length: 7 }, (_, i) => entry(9 - i, { promptSummary: `Task ${i}` }));
  const agg = dec(fmt.formatAggregatedChanges(many));
  check('E: aggregated shows 5 summaries', hasPhrase(agg, '5. Task 4'), agg.slice(0, 300));
  check('E: aggregated overflow marker', hasPhrase(agg, '2 more'), agg.slice(-200));

  // ------------------------------------------------------------------
  // F. Toggle off -> nothing sent but state still advances
  // ------------------------------------------------------------------
  const before = settingsService.getSettings().botNotifyOnCodeChange;
  settingsService.updateSettings({ botNotifyOnCodeChange: false });
  writeEntries([entry(8), entry(7), entry(6), entry(5), entry(4), entry(3), entry(2), entry(1)]);
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('F: nothing sent while off', sock.sent.length === 0, String(sock.sent.length));
  check('F: reported as skipped', res.skipped === true);
  check('F: state still advanced (no backlog)', svc.loadNotifiedState().lastNotifiedId === entry(8).id, svc.loadNotifiedState().lastNotifiedId);

  // Turning it back on must not replay the suppressed entry.
  settingsService.updateSettings({ botNotifyOnCodeChange: before });
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('F: no replay after re-enabling', sock.sent.length === 0 && res.pending === 0, 'sent=' + sock.sent.length);

  // ------------------------------------------------------------------
  // G. Missing dev-changes.json -> warn, no crash
  // ------------------------------------------------------------------
  fs.rmSync(devChangesFile, { force: true });
  check('G: loadDevChanges returns []', svc.loadDevChanges().length === 0);
  check('G: getPendingChanges returns []', svc.getPendingChanges().length === 0);
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('G: notifier does not throw', res.sent === 0 && res.pending === 0);
  check('G: nothing sent', sock.sent.length === 0);
  // Corrupt JSON must behave the same way.
  fs.writeFileSync(devChangesFile, '{ not json', 'utf8');
  check('G: corrupt file returns []', svc.loadDevChanges().length === 0);
  sock = makeSock();
  res = await notifyPendingDevChanges(sock);
  check('G: corrupt file does not throw', res.sent === 0);

  // ------------------------------------------------------------------
  // H. Multiple admins each receive it
  // ------------------------------------------------------------------
  const configMod = (await import('../src/config/config.js')).default;
  const savedAdmins = [...configMod.adminJids];
  try {
    configMod.adminJids = ['111@lid', '222@lid', '333@lid'];
    writeEntries([entry(9), entry(8)]);
    clearState();
    sock = makeSock();
    res = await notifyPendingDevChanges(sock);
    check('H: one message per admin (3)', sock.sent.length === 3, String(sock.sent.length));
    const recipients = new Set(sock.sent.map((m) => m.jid));
    check('H: all three admins distinct', recipients.size === 3, [...recipients].join(','));
    check('H: every admin got the same text', new Set(sock.sent.map((m) => m.text)).size === 1);
    check('H: sent counter matches', res.sent === 3, String(res.sent));
  } finally {
    configMod.adminJids = savedAdmins;
  }

  // ------------------------------------------------------------------
  // Extra: one unreachable admin must not block the others
  // ------------------------------------------------------------------
  {
    const configMod = (await import('../src/config/config.js')).default;
    const saved = [...configMod.adminJids];
    try {
      configMod.adminJids = ['bad@lid', 'good@lid'];
      writeEntries([entry(11), entry(10)]);
      clearState();
      const flaky = {
        sent: [],
        async sendMessage(jid, content) {
          if (jid === 'bad@lid') throw new Error('unreachable');
          this.sent.push({ jid, text: String(content?.text ?? '') });
          return { key: { id: 'k' } };
        },
        async sendPresenceUpdate() {},
        async readMessages() { return true; }
      };
      res = await notifyPendingDevChanges(flaky);
      check('extra: failing admin does not stop delivery', flaky.sent.length === 1, String(flaky.sent.length));
      check('extra: state still advanced', svc.loadNotifiedState().lastNotifiedId === entry(11).id);
    } finally {
      configMod.adminJids = saved;
    }
  }

  // ------------------------------------------------------------------
  // Extra: stale state id (history rewritten) re-reports rather than skipping
  // ------------------------------------------------------------------
  {
    writeEntries([entry(21), entry(20)]);
    fs.writeFileSync(stateFile, JSON.stringify({ lastNotifiedId: 'chg-does-not-exist', lastNotifiedAt: null }), 'utf8');
    check('extra: unknown state id re-reports all', svc.getPendingChanges().length === 2, String(svc.getPendingChanges().length));
  }

  // ------------------------------------------------------------------
  // Extra: formatting invariants
  // ------------------------------------------------------------------
  check('extra: single format has a Code Update heading', fmt.formatSingleChange(entry(1)).startsWith('🛠️ '));
  check('extra: empty entry list formats to empty string', fmt.formatAggregatedChanges([]) === '');
  check('extra: null entry formats to empty string', fmt.formatSingleChange(null) === '');
  check('extra: bad timestamp does not produce NaN', !fmt.relativeTime('not-a-date').includes('NaN'));
  check('extra: bad timestamp in window is safe', fmt.__testing.fmtTime('nope') === '--:--');
  // ------------------------------------------------------------------
  // Extra: the Bot Notifications row for this toggle is fully wired
  // ------------------------------------------------------------------
  {
    const { getMenu } = await import('../src/config/menus/registry.js');
    const { dynamicSuffixResolvers } = await import('../src/utils/menuResolvers.js');
    const { botNotificationCustomHandlers } = await import('../src/utils/menuCustomHandlers.js');
    const { t } = await import('../src/services/localeService.js');
    await import('../src/config/menus/index.js');

    const menu = getMenu('bot_notifications');
    const menuUser = { jid: '988000000000009@lid', name: 'Menu Test', username: 'menutest', language: 'en', preferences: {}, stats: {} };
    check('menu: bot_notifications has seven options', menu.options.length === 7, String(menu.options.length));
    const opt7 = menu.options.find((o) => String(o.number) === '7');
    check('menu: option 7 exists', !!opt7);
    check('menu: option 7 action is the code-change toggle', opt7?.action === 'custom:toggle_code_change_notifs', opt7?.action);
    check('menu: option 7 uses the codeChangeState suffix', opt7?.dynamicSuffix === 'codeChangeState', opt7?.dynamicSuffix);
    check('menu: option 7 handler is registered', typeof botNotificationCustomHandlers.toggle_code_change_notifs === 'function');
    check('menu: option 7 suffix resolver is registered', typeof dynamicSuffixResolvers.codeChangeState === 'function');

    for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
      const label = t(lang, opt7.labelKey);
      check('menu: ' + lang + ' has a label for option 7', typeof label === 'string' && label !== opt7.labelKey && label.length > 0, String(label));
    }
    const suffix7 = dynamicSuffixResolvers.codeChangeState(menuUser, 'en');
    check('menu: option 7 suffix renders an on/off flag', hasPhrase(suffix7, 'on') || hasPhrase(suffix7, 'off'), suffix7);
  }
} finally {
  restoreAll();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
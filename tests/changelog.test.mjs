// Version History (Info -> 2), driven by data/changelog.json.
//
// Covers the JSON loader, pagination maths, the type-to-emoji mapping, the
// rendered layout (version numbers and dates must NOT be small-capped), the
// shifting option numbers, and the graceful fallback when the file is missing.
//
// data/ is backed up and restored, and the changelog file is restored too, so
// the missing-file case cannot leave the repo without it.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
const backupDir = path.join(os.tmpdir(), 'changelog-data-backup');

fs.rmSync(backupDir, { recursive: true, force: true });
fs.cpSync(dataDir, backupDir, { recursive: true });
const restoreData = () => {
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
// dec() always yields lower case, so phrase checks are case-insensitive. Note
// toSmallCaps leaves some letters (e.g. 's') untouched because the small-caps
// block has no codepoint for them.
const hasPhrase = (haystack, phrase) => dec(haystack).toLowerCase().includes(phrase.toLowerCase());

const svc = await import('../src/services/changelogService.js');
const fmt = await import('../src/utils/changelogFormat.js');
const { renderMenu } = await import('../src/utils/menuRenderer.js');
const { getMenu } = await import('../src/config/menus/registry.js');
const sessionManager = (await import('../src/utils/sessionManager.js')).default;
await import('../src/config/menus/index.js');

const JID = '988000000000001@lid';
const user = { jid: JID, name: 'Changelog Test', username: 'cltest', language: 'en', preferences: {}, stats: { commandsUsed: 0, messagesSent: 0 } };

function resetPage(page) {
  sessionManager.setState(JID, JID, { currentMenu: 'info_version', changelogPage: page });
}

async function renderVersionPage(page) {
  resetPage(page);
  return renderMenu('info_version', user, 'en', { sender: JID, chatId: JID });
}

try {
  // ------------------------------------------------------------------
  // 1. Loader
  // ------------------------------------------------------------------
  const log = svc.reload();
  check('loads currentVersion', typeof log.currentVersion === 'string' && log.currentVersion.length > 0, log.currentVersion);
  check('loads entries', Array.isArray(log.entries) && log.entries.length >= 3, String(log.entries?.length));
  check('currentVersion matches the newest entry', log.currentVersion === log.entries[0]?.version, log.currentVersion + ' vs ' + log.entries[0]?.version);

  const entries = svc.getEntries();
  check('entries are newest first', entries.every((e, i) => i === 0 || entries[i - 1].date >= e.date), JSON.stringify(entries.map((e) => e.date)));
  const VALID_TYPES = ['feature', 'improvement', 'fix', 'breaking', 'security', 'initial'];
  check('every type is valid', entries.every((e) => VALID_TYPES.includes(e.type)), JSON.stringify(entries.map((e) => e.type)));
  check('every entry has a YYYY-MM-DD date', entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), JSON.stringify(entries.map((e) => e.date)));
  check('every change list is non-empty strings', entries.every((e) => Array.isArray(e.changes) && e.changes.every((c) => typeof c === 'string' && c.trim().length)));
  check('no emojis inside change strings', entries.every((e) => e.changes.every((c) => !/\p{Extended_Pictographic}/u.test(c))));

  // ------------------------------------------------------------------
  // 2. Pagination maths
  // ------------------------------------------------------------------
  const p1 = svc.getEntriesPage(1, 2);
  check('page 1 holds 2 entries', p1.entries.length === 2, String(p1.entries.length));
  check('page 1 has next', p1.hasNext === true);
  check('page 1 has no previous', p1.hasPrev === false);
  const lastPage = Math.ceil(entries.length / 2);
  const pLast = svc.getEntriesPage(lastPage, 2);
  check('last page has no next', pLast.hasNext === false);
  check('last page has previous', pLast.hasPrev === true || lastPage === 1);
  check('a huge page is clamped, not empty', svc.getEntriesPage(9999, 2).entries.length > 0, 'clamped empty');
  check('page 0 is clamped to 1', svc.getEntriesPage(0, 2).page === 1);
  check('NaN page is clamped to 1', svc.getEntriesPage(NaN, 2).page === 1);

  // ------------------------------------------------------------------
  // 3. Type mapping
  // ------------------------------------------------------------------
  check('feature -> sparkles', fmt.getTypeMeta('feature').emoji === '✨');
  check('fix -> bug', fmt.getTypeMeta('fix').emoji === '🐛');
  check('initial -> party', fmt.getTypeMeta('initial').emoji === '🎉');
  check('unknown type falls back', fmt.getTypeMeta('nonsense').label === 'update', fmt.getTypeMeta('nonsense').label);

  // ------------------------------------------------------------------
  // 4. Rendered layout
  // ------------------------------------------------------------------
  const rendered = await renderVersionPage(1);
  const text = rendered.text;
  check('heading is the version history title', text.startsWith('> *') && hasPhrase(text.split('\n')[0], 'Version History'), text.split('\n')[0]);

  check('current version shown as a dynamic value', text.includes(svc.getCurrentVersion()), svc.getCurrentVersion());
  // Versions/dates are digits, which toSmallCaps never rewrites; what matters is
  // that they are present verbatim rather than mangled.
  check('current version appears verbatim on its own line', new RegExp('current version.*' + svc.getCurrentVersion().replace(/\./g, '\\.'), 'i').test(dec(text)), 'not found');

  const firstEntry = entries[0];
  check('newest entry version rendered literally', text.includes(firstEntry.version));
  check('newest entry date rendered literally', text.includes(firstEntry.date), firstEntry.date);
  check('newest entry type emoji present', text.includes(fmt.getTypeMeta(firstEntry.type).emoji));
  check('every change bullet present', firstEntry.changes.every((c) => hasPhrase(text, c)), 'missing a change bullet');
  check('bullets use a leading marker', text.split('\n').some((l) => l.trim().startsWith('•')));

  check('page 1 shows the See more option', hasPhrase(text, 'See more'));
  check('page 1 shows the Subscribe option', hasPhrase(text, 'Subscribe to updates'));
  check('page 1 hides Previous', !hasPhrase(text, 'Previous'));
  check('back row present', /(^|\n)0\.\s/.test(text));

  // Second page: Previous appears, See more gone, Subscribe renumbered.
  const page2 = await renderVersionPage(2);
  check('page 2 shows Previous', hasPhrase(page2.text, 'Previous'));
  check('page 2 hides See more', !hasPhrase(page2.text, 'See more'));
  check('page 2 still shows Subscribe', hasPhrase(page2.text, 'Subscribe to updates'));
  check('page 2 shows the oldest entry', page2.text.includes(entries[entries.length - 1].version));

  // ------------------------------------------------------------------
  // 5. Option numbering shifts, and input resolves consistently
  // ------------------------------------------------------------------
  const first = svc.getEntriesPage(1, 2);
  const opts1 = fmt.changelogOptions(first);
  check('page 1 option map is [more, subscribe]', opts1.map((o) => o.key).join(',') === 'more,subscribe', opts1.map((o) => o.key).join(','));
  check('page 1 numbers are 1,2', opts1.map((o) => o.number).join(',') === '1,2');
  check('page 1 input 1 -> more', fmt.resolveChangelogAction('1', first) === 'more');
  check('page 1 input 2 -> subscribe', fmt.resolveChangelogAction('2', first) === 'subscribe');

  const second = svc.getEntriesPage(2, 2);
  const opts2 = fmt.changelogOptions(second);
  check('page 2 option map is [previous, subscribe]', opts2.map((o) => o.key).join(',') === 'previous,subscribe', opts2.map((o) => o.key).join(','));
  check('page 2 input 1 -> previous', fmt.resolveChangelogAction('1', second) === 'previous');
  check('page 2 input 2 -> subscribe', fmt.resolveChangelogAction('2', second) === 'subscribe');

  const middle = { hasPrev: true, hasNext: true };
  check('middle page is [previous, more, subscribe]', fmt.changelogOptions(middle).map((o) => o.key).join(',') === 'previous,more,subscribe');
  check('subscribe is always last', fmt.changelogOptions({ hasPrev: true, hasNext: false }).at(-1).key === 'subscribe');
  check('subscribe is always last (page 1)', fmt.changelogOptions({ hasPrev: false, hasNext: true }).at(-1).key === 'subscribe');
  check('unrecognised input resolves to null', fmt.resolveChangelogAction('9', first) === null);
  check('empty input resolves to null', fmt.resolveChangelogAction('', first) === null);

  // The rendered rows must agree with the option map, or "1" would be a lie.
  for (const page of [1, 2]) {
    const renderedPage = await renderVersionPage(page);
    const info = svc.getEntriesPage(page, 2);
    for (const opt of fmt.changelogOptions(info)) {
      check('page ' + page + ' renders option ' + opt.number + ' (' + opt.key + ')', renderedPage.text.includes(opt.number + '. ' + opt.emoji), 'missing row');
    }
  }

  // ------------------------------------------------------------------
  // 6. Missing / corrupt file degrades gracefully
  // ------------------------------------------------------------------
  const changelogFile = path.join(dataDir, 'changelog.json');
  const saved = fs.readFileSync(changelogFile, 'utf8');
  try {
    fs.rmSync(changelogFile);
    const empty = svc.reload();
    check('missing file falls back to 0.0.0', empty.currentVersion === '0.0.0', empty.currentVersion);
    check('missing file yields no entries', empty.entries.length === 0);
    const emptyRender = await renderVersionPage(1);
    check('empty changelog still renders a menu', emptyRender.text.length > 0);
    check('empty changelog shows the empty notice', hasPhrase(emptyRender.text, 'No version information'), emptyRender.text.slice(0, 200));
    check('empty changelog still offers Subscribe', hasPhrase(emptyRender.text, 'Subscribe to updates'));
    check('empty changelog hides See more', !hasPhrase(emptyRender.text, 'See more'));

    fs.writeFileSync(changelogFile, '{ not json', 'utf8');
    const broken = svc.reload();
    check('corrupt file falls back to 0.0.0', broken.currentVersion === '0.0.0', broken.currentVersion);
    const brokenRender = await renderVersionPage(1);
    check('corrupt changelog still renders', brokenRender.text.length > 0);

    // Prove the content really comes from the file, not hardcoded text.
    const custom = {
      currentVersion: '9.9.9',
      releasedAt: '2026-10-01T00:00:00Z',
      entries: [{ version: '9.9.9', date: '2026-12-25', type: 'security', changes: ['Totally unique marker string'] }]
    };
    fs.writeFileSync(changelogFile, JSON.stringify(custom, null, 2), 'utf8');
    svc.reload();
    const customRender = await renderVersionPage(1);
    check('edited file drives the content', hasPhrase(customRender.text, 'Totally unique marker string'), customRender.text.slice(0, 300));
    check('edited file drives the current version', customRender.text.includes('9.9.9'));
    check('edited file drives the date', customRender.text.includes('2026-12-25'));
    check('single entry hides See more', !hasPhrase(customRender.text, 'See more'));
  } finally {
    fs.writeFileSync(changelogFile, saved, 'utf8');
    svc.reload();
  }

  // ------------------------------------------------------------------
  // 7. Translations
  // ------------------------------------------------------------------
  const { t } = await import('../src/services/localeService.js');
  for (const lang of ['en', 'fr', 'de', 'es', 'ar']) {
    for (const key of ['heading', 'currentVersion', 'seeMore', 'previous', 'subscribe', 'comingSoon', 'empty']) {
      check(lang + ' has menu.info.version_history.' + key, typeof t(lang, 'menu.info.version_history.' + key) === 'string' && t(lang, 'menu.info.version_history.' + key) !== 'menu.info.version_history.' + key);
    }
    // The pre-existing string must survive.
    check(lang + ' menu.info.version is still a string', typeof t(lang, 'menu.info.version') === 'string', typeof t(lang, 'menu.info.version'));
  }

  // Info menu option 2 still resolves to the string label.
  const infoMenu = getMenu('info');
  const opt2 = infoMenu.options.find((o) => String(o.number) === '2');
  check('Info option 2 label resolves to a string', typeof t('en', opt2.labelKey) === 'string', opt2.labelKey);
} finally {
  restoreData();
}

console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
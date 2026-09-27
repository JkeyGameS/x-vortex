import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { addEntry, getAllEntries, getEntry, deleteEntry } from './faqService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const BUILTIN_FILE = path.join(DATA_DIR, 'builtinFaqTemplates.json');
const CUSTOM_FILE = path.join(DATA_DIR, 'customFaqTemplates.json');
const UPDATES_FILE = path.join(DATA_DIR, 'faqPackUpdates.json');

const DEFAULT_PACKS = {
  profile_pack: {
    version: 1, nameKey: 'faqtemplates.profilePack', emoji: '👤', category: 'profile',
    tags: ['profile', 'account', 'essential'],
    entries: [
      {
        question: 'How do I edit my profile?',
        answer: 'Open Profile from the main menu, then choose Edit.',
        keywords: ['profile', 'edit', 'change'],
        language: 'en'
      },
      {
        question: 'What is my ID?',
        answer: 'Your ID is shown at the top of your profile page.',
        keywords: ['id', 'profile', 'who'],
        language: 'en'
      },
      {
        question: 'How do I change my username?',
        answer: 'Open Profile, tap Edit, then enter a new username and save.',
        keywords: ['username', 'change', 'name'],
        language: 'en'
      }
    ]
  },
  settings_pack: {
    version: 1, nameKey: 'faqtemplates.settingsPack', emoji: '⚙️', category: 'settings',
    tags: ['settings', 'preferences', 'essential'],
    entries: [
      {
        question: 'What are Preferences?',
        answer: 'Preferences let you customize notifications, language and privacy.',
        keywords: ['preferences', 'settings'],
        language: 'en'
      },
      {
        question: 'How do I disable notifications?',
        answer: 'Go to Preferences, then Notifications, and turn them off.',
        keywords: ['notifications', 'disable', 'off'],
        language: 'en'
      },
      {
        question: 'How do I change language?',
        answer: 'Go to Preferences, then Language Selection, and pick a language.',
        keywords: ['language', 'change', 'idioma', 'langue', 'sprache'],
        language: 'en'
      }
    ]
  },
  privacy_pack: {
    version: 1, nameKey: 'faqtemplates.privacyPack', emoji: '🔐', category: 'privacy',
    tags: ['privacy', 'safety'],
    entries: [
      {
        question: 'Who can see my profile?',
        answer: 'Only people you interact with can see your public profile info.',
        keywords: ['profile', 'see', 'privacy', 'visible'],
        language: 'en'
      },
      {
        question: 'How do I block a user?',
        answer: 'Open the user menu and choose Block, then confirm.',
        keywords: ['block', 'user', 'spam'],
        language: 'en'
      }
    ]
  },
  selfdestruct_pack: {
    version: 1, nameKey: 'faqtemplates.selfdestructPack', emoji: '💬', category: 'chat_messaging',
    tags: ['messages', 'privacy', 'disappearing'],
    entries: [
      {
        question: 'How do I make messages disappear?',
        answer: 'Enable self-destruct in the chat settings and set a timer.',
        keywords: ['disappear', 'self-destruct', 'timer', 'messages'],
        language: 'en'
      },
      {
        question: 'What is native disappearing?',
        answer: 'Native disappearing uses the built-in timer of the messaging app.',
        keywords: ['native', 'disappearing', 'timer'],
        language: 'en'
      }
    ]
  },
  help_pack: {
    version: 1, nameKey: 'faqtemplates.helpPack', emoji: '🆘', category: 'help_support',
    tags: ['help', 'essential', 'support'],
    featured: true,
    entries: [
      {
        question: 'What can you do?',
        answer: 'I can chat, answer questions from the knowledge base, and run commands. Try /help.',
        keywords: ['what', 'can', 'do', 'help', 'commands'],
        language: 'en'
      },
      {
        question: 'How do I use this bot?',
        answer: 'Just send me a message. Use /help to see everything I can do.',
        keywords: ['use', 'how', 'start', 'bot'],
        language: 'en'
      },
      {
        question: 'How do I contact support?',
        answer: 'Use the Feedback menu to reach the support team.',
        keywords: ['support', 'contact', 'help'],
        language: 'en'
      }
    ]
  },
  feedback_pack: {
    version: 1, nameKey: 'faqtemplates.feedbackPack', emoji: '⭐', category: 'help_support',
    tags: ['feedback', 'rating'],
    entries: [
      {
        question: 'How do I rate the bot?',
        answer: 'Open the Feedback menu and choose Rate to leave a rating.',
        keywords: ['rate', 'rating', 'feedback', 'stars'],
        language: 'en'
      },
      {
        question: 'How do I report a bug?',
        answer: 'Open the Feedback menu, choose Report a Bug, and describe the issue.',
        keywords: ['bug', 'report', 'error', 'issue'],
        language: 'en'
      }
    ]
  },
  bot_info_pack: {
    version: 1, nameKey: 'faqtemplates.botInfoPack', emoji: '🤖', category: 'bot_info',
    tags: ['bot', 'info'],
    featured: true,
    entries: [
      {
        question: 'Who made you?',
        answer: 'I was built by the X-Vortex team.',
        keywords: ['who', 'made', 'creator', 'created'],
        language: 'en'
      },
      {
        question: 'What is X-Vortex?',
        answer: 'X-Vortex is a friendly assistant bot for chatting and quick answers.',
        keywords: ['x-vortex', 'what', 'bot'],
        language: 'en'
      }
    ]
  },
  fun_pack: {
    version: 1, nameKey: 'faqtemplates.funPack', emoji: '🎉', category: 'fun_extras',
    tags: ['fun', 'humor'],
    entries: [
      {
        question: 'Tell me a joke',
        answer: 'Why did the bot go to school? To improve its neural-netiquette!',
        keywords: ['joke', 'funny', 'laugh'],
        language: 'en'
      },
      {
        question: "What's your favorite color?",
        answer: 'Electric blue — the color of a fresh chat bubble.',
        keywords: ['favorite', 'color', 'colour'],
        language: 'en'
      }
    ]
  },
  multilang_basics: {
    version: 1, nameKey: 'faqtemplates.multilangBasics', emoji: '🌍', category: 'help_support', multi: true,
    tags: ['multilingual', 'essential', 'onboarding'],
    featured: true,
    entries: [
      {
        question: 'How do I use this bot?',
        answer: 'Just send me a message. Use /help to see everything I can do.',
        keywords: ['use', 'how', 'start'],
        language: 'en'
      },
      {
        question: 'Comment utiliser ce bot ?',
        answer: 'Envoyez-moi simplement un message. Tapez /help pour tout voir.',
        keywords: ['utiliser', 'comment', 'bot'],
        language: 'fr'
      },
      {
        question: 'Wie benutze ich diesen Bot?',
        answer: 'Schick mir einfach eine Nachricht. Tippe /help für alles.',
        keywords: ['benutzen', 'wie', 'bot'],
        language: 'de'
      },
      {
        question: '¿Cómo uso este bot?',
        answer: 'Solo envíame un mensaje. Escribe /help para verlo todo.',
        keywords: ['usar', 'cómo', 'bot'],
        language: 'es'
      },
      {
        question: 'كيف أستخدم هذا البوت؟',
        answer: 'فقط أرسل لي رسالة. اكتب /help لرؤية كل شيء.',
        keywords: ['استخدام', 'كيف', 'بوت'],
        language: 'ar'
      },
      {
        question: 'How do I change language?',
        answer: 'Go to Preferences, then Language Selection.',
        keywords: ['language', 'change'],
        language: 'en'
      },
      {
        question: 'Comment changer de langue ?',
        answer: 'Allez dans Préférences, puis Sélection de la langue.',
        keywords: ['langue', 'changer'],
        language: 'fr'
      },
      {
        question: 'Wie ändere ich die Sprache?',
        answer: 'Gehe zu Einstellungen, dann Sprachauswahl.',
        keywords: ['sprache', 'ändern'],
        language: 'de'
      },
      {
        question: '¿Cómo cambio el idioma?',
        answer: 'Ve a Preferencias, luego Selección de idioma.',
        keywords: ['idioma', 'cambiar'],
        language: 'es'
      },
      {
        question: 'كيف أغير اللغة؟',
        answer: 'اذهب إلى التفضيلات، ثم اختيار اللغة.',
        keywords: ['اللغة', 'تغيير'],
        language: 'ar'
      }
    ]
  }
};

let builtins = null;
let customs = null;

function readJson(file) {
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load FAQ template file');
  }
  return null;
}

function writeJson(file, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save FAQ template file');
  }
}

function sanitizeEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries
    .filter((e) => e && typeof e.question === 'string' && e.question.trim() && typeof e.answer === 'string')
    .map((e) => ({
      question: e.question.trim().slice(0, 200),
      answer: String(e.answer).slice(0, 1000),
      answerVariants: Array.isArray(e.answerVariants) ? e.answerVariants.map((a) => String(a)).filter(Boolean).slice(0, 5) : [],
      keywords: Array.isArray(e.keywords) ? e.keywords.map((k) => String(k).toLowerCase()).filter(Boolean).slice(0, 12) : [],
      language: ['en', 'fr', 'de', 'es', 'ar', 'all'].includes(e.language) ? e.language : 'en',
      category: typeof e.category === 'string' ? e.category : null,
      priority: Math.min(10, Math.max(1, Number(e.priority) || 1))
    }));
}

function sanitizePack(id, raw, isCustom) {
  if (!raw || typeof raw !== 'object') return null;
  const entries = sanitizeEntries(raw.entries || raw.rules);
  if (!entries.length) return null;
  return {
    id,
    version: Number(raw.version) || 1,
    nameKey: raw.nameKey || raw.name || id,
    name: typeof raw.name === 'string' ? raw.name : null,
    emoji: raw.emoji || '📦',
    category: raw.category || 'misc',
    multi: raw.multi === true,
    featured: raw.featured === true,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((x) => typeof x === 'string').slice(0, 8) : [],
    isCustom: isCustom === true,
    entries
  };
}

function serialize(map, includeCustom) {
  const out = {};
  for (const [id, p] of Object.entries(map)) {
    out[id] = {
      version: p.version, nameKey: p.nameKey, ...(p.name ? { name: p.name } : {}),
      emoji: p.emoji, category: p.category, multi: p.multi,
      ...(p.featured ? { featured: true } : {}),
      ...(p.tags?.length ? { tags: [...p.tags] } : {}),
      ...(includeCustom ? { isCustom: true } : {}), entries: p.entries
    };
  }
  return out;
}

function load() {
  const fromDisk = readJson(BUILTIN_FILE);
  builtins = {};
  const source = fromDisk && Object.keys(fromDisk).length ? fromDisk : DEFAULT_PACKS;
  for (const [id, raw] of Object.entries(source)) {
    const pack = sanitizePack(id, raw, false);
    if (pack) builtins[id] = pack;
  }
  if (!fromDisk || !Object.keys(fromDisk).length) writeJson(BUILTIN_FILE, serialize(builtins, false));
  customs = {};
  const customDisk = readJson(CUSTOM_FILE);
  if (customDisk) {
    for (const [id, raw] of Object.entries(customDisk)) {
      if (builtins[id]) continue;
      const pack = sanitizePack(id, raw, true);
      if (pack) customs[id] = pack;
    }
  } else {
    writeJson(CUSTOM_FILE, {});
  }
}

load();

function shape(pack) {
  return { ...pack, tags: [...(pack.tags || [])], entries: pack.entries.map((e) => ({ ...e })) };
}

export function reloadFaqTemplates() {
  load();
}

export function getFaqPacks() {
  if (!builtins) load();
  return [...Object.values(builtins), ...Object.values(customs)].map(shape);
}

export function getFaqPack(id) {
  if (!builtins) load();
  const pack = builtins[id] || customs[id];
  return pack ? shape(pack) : null;
}

export function isBuiltinFaqPack(id) {
  if (!builtins) load();
  return Boolean(builtins[id]);
}

export function getFaqPacksByCategory(category) {
  return getFaqPacks()
    .filter((p) => (p.category || 'misc') === category)
    .sort((a, b) => Number(b.featured === true) - Number(a.featured === true));
}

export function getFeaturedFaqPacks() {
  return getFaqPacks().filter((p) => p.featured === true);
}

export function collectFaqTags() {
  const set = new Map();
  for (const pack of getFaqPacks()) {
    for (const tag of pack.tags || []) {
      const key = String(tag).toLowerCase();
      if (!set.has(key)) set.set(key, { tag: String(tag), count: 0 });
      set.get(key).count += 1;
    }
  }
  return [...set.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

export function faqPacksWithTag(tag) {
  const key = String(tag).toLowerCase();
  return getFaqPacks().filter((p) => (p.tags || []).some((t) => String(t).toLowerCase() === key));
}

export function searchFaqTemplates(query, { nameMatches = [] } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const pack of getFaqPacks()) {
    const hits = [];
    if (pack.id.toLowerCase().includes(q)) hits.push({ field: 'id', context: pack.id });
    if (nameMatches.includes(pack.id)) hits.push({ field: 'name', context: pack.id });
    for (const tag of pack.tags || []) {
      if (String(tag).toLowerCase().includes(q)) hits.push({ field: 'tag', context: String(tag) });
    }
    for (const e of pack.entries || []) {
      if (String(e.question || '').toLowerCase().includes(q)) hits.push({ field: 'question', context: String(e.question).slice(0, 60) });
      for (const kw of e.keywords || []) {
        if (String(kw).toLowerCase().includes(q)) { hits.push({ field: 'keyword', context: String(kw) }); break; }
      }
      if (String(e.answer || '').toLowerCase().includes(q)) hits.push({ field: 'answer', context: String(e.answer).slice(0, 60) });
    }
    if (hits.length) out.push({ packId: pack.id, hits: hits.slice(0, 3) });
  }
  return out;
}

export function resolveFaqPackEntries(pack, language) {
  const out = [];
  for (const e of pack.entries || []) {
    if (!e.question || !e.answer) continue;
    if (language === 'all') {
      out.push({ ...e, language: e.language || 'en' });
    } else {
      if ((e.language || 'en') !== language) continue;
      out.push({ ...e, language });
    }
  }
  return out;
}

export function installedFaqPackEntries(packId, language = null) {
  return getAllEntries().filter((e) => e.packId === packId && (!language || language === 'all' || e.language === language));
}

export function installFaqPackEntries(packId, entries, { mode = 'fresh', createdBy = '' } = {}) {
  const pack = getFaqPack(packId);
  const packVersion = pack?.version || 1;
  let added = 0;
  let skipped = 0;
  const existing = installedFaqPackEntries(packId);
  for (const e of entries) {
    if (mode === 'add-new') {
      const dupe = existing.find((e2) => e2.language === e.language
        && String(e2.question || '').toLowerCase() === String(e.question || '').toLowerCase());
      if (dupe) {
        skipped++;
        continue;
      }
    }
    addEntry({
      question: e.question,
      answer: e.answer,
      answerVariants: e.answerVariants || [],
      keywords: e.keywords || [],
      language: e.language || 'en',
      category: e.category || pack?.category || '',
      priority: e.priority || 1,
      createdBy,
      enabled: true,
      packId,
      packVersion,
      createdFrom: 'template'
    });
    added++;
  }
  return { added, skipped };
}

export function uninstallFaqPack(packId) {
  const victims = getAllEntries().filter((e) => e.packId === packId);
  for (const v of victims) deleteEntry(v.id);
  return victims.length;
}

export function clearFaqPackLanguage(packId, language) {
  const victims = installedFaqPackEntries(packId, language);
  for (const v of victims) deleteEntry(v.id);
  return victims.length;
}

export function exportFaqTemplatePacks(scope = 'all') {
  if (!builtins) load();
  const out = {};
  const collect = (list) => {
    for (const p of list) {
      out[p.id] = {
        version: p.version, nameKey: p.nameKey, ...(p.name ? { name: p.name } : {}),
        emoji: p.emoji, category: p.category, multi: p.multi,
        ...(p.tags?.length ? { tags: [...p.tags] } : {}),
        ...(p.isCustom ? { isCustom: true } : {}), entries: p.entries
      };
    }
  };
  if (scope === 'custom') collect(Object.values(customs));
  else {
    collect(Object.values(builtins));
    collect(Object.values(customs));
  }
  return out;
}

/** Sanitize a raw import object {id: pack} into validated packs. */
export function sanitizeFaqImport(src) {
  const packs = [];
  for (const [id, raw] of Object.entries(src || {})) {
    if (!/^[a-z0-9_]{3,40}$/.test(id)) continue;
    if (!raw || typeof raw !== 'object' || !raw.emoji || !raw.category) continue;
    const pack = sanitizePack(id, raw, true);
    if (pack) packs.push(pack);
  }
  return packs;
}

/** Import validated packs. Conflicts auto-keep-both. Built-ins never overwritten. */
export function importFaqTemplatePacks(packs, { conflict = 'keep-both' } = {}) {
  if (!builtins) load();
  let imported = 0;
  let skipped = 0;
  let renamed = 0;
  for (const pack of packs) {
    if (builtins[pack.id] || customs[pack.id]) {
      if (conflict === 'keep-both') {
        const newId = `${pack.id}_${Date.now().toString(36)}`;
        customs[newId] = { ...pack, id: newId, isCustom: true };
        renamed++;
        imported++;
      } else {
        skipped++;
      }
      continue;
    }
    customs[pack.id] = { ...pack, isCustom: true };
    imported++;
  }
  const out = {};
  for (const [pid, p] of Object.entries(customs)) {
    out[pid] = {
      version: p.version, name: p.name, nameKey: p.nameKey, emoji: p.emoji, category: p.category,
      multi: p.multi, isCustom: true,
      ...(p.tags?.length ? { tags: [...p.tags] } : {}), entries: p.entries
    };
  }
  writeJson(CUSTOM_FILE, out);
  return { imported, skipped, renamed };
}

export function checkForFaqPackUpdates() {
  if (!builtins) load();
  const installed = {};
  for (const e of getAllEntries()) {
    if (!e.packId) continue;
    if (!installed[e.packId]) installed[e.packId] = { version: e.packVersion || 1, count: 0 };
    installed[e.packId].count += 1;
    if ((e.packVersion || 1) > installed[e.packId].version) installed[e.packId].version = e.packVersion;
  }
  const pending = [];
  for (const [id, pack] of Object.entries(builtins)) {
    const inst = installed[id];
    if (inst && pack.version > inst.version) {
      pending.push({ packId: id, installedVersion: inst.version, availableVersion: pack.version, installedCount: inst.count });
    }
  }
  writeJson(UPDATES_FILE, { checkedAt: new Date().toISOString(), pending });
  return pending;
}

export function getFaqPackUpdates() {
  const raw = readJson(UPDATES_FILE);
  return raw && Array.isArray(raw.pending) ? raw.pending : [];
}

export function applyFaqPackUpdate(packId, createdBy = '') {
  if (!builtins) load();
  const pack = builtins[packId];
  if (!pack) return { updated: 0, languages: [] };
  const old = installedFaqPackEntries(packId);
  const langs = [...new Set(old.map((e) => e.language || 'en'))];
  for (const e of old) deleteEntry(e.id);
  let updated = 0;
  const targets = langs.length ? langs : ['en'];
  for (const lang of targets) {
    updated += installFaqPackEntries(packId, resolveFaqPackEntries(pack, lang), { createdBy }).added;
  }
  checkForFaqPackUpdates();
  return { updated, languages: targets };
}

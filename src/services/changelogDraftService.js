// Draft changelog entries awaiting an admin's review.
//
// A draft is created automatically from each new dev-changes.json entry, then
// the admin approves, edits or discards it in the Changelog Manager.
//
// This file lives under data/ and is git-ignored: it is mutable workflow state,
// not authored content (unlike data/changelog.json, which is tracked).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// Module-relative, not process.cwd(): the working directory is not guaranteed to
// be the repo root on a PaaS host.
const DRAFTS_PATH = path.join(ROOT, 'data', 'changelogDrafts.json');

function read() {
  try {
    const raw = fs.readFileSync(DRAFTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { drafts: [] };
    return { drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [] };
  } catch {
    // Missing or corrupt file: treated as "no drafts", never a throw.
    return { drafts: [] };
  }
}

function write(data) {
  try {
    const dir = path.dirname(DRAFTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DRAFTS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    logger.error({ err, path: DRAFTS_PATH }, '[DRAFTS] failed to write');
    return false;
  }
}

export function getAllDrafts() {
  return read().drafts || [];
}

/** Drafts still awaiting review. Discarded ones are kept for audit but hidden. */
export function getPendingDrafts() {
  return getAllDrafts().filter((d) => d.status === 'pending');
}

export function getDraftById(id) {
  return getAllDrafts().find((d) => d.id === id);
}

export function addDraft(draft) {
  const data = read();
  data.drafts = data.drafts || [];
  data.drafts.unshift(draft);
  write(data);
  return draft;
}

export function updateDraft(id, patch) {
  const data = read();
  const idx = (data.drafts || []).findIndex((d) => d.id === id);
  if (idx < 0) return null;
  data.drafts[idx] = { ...data.drafts[idx], ...patch };
  write(data);
  return data.drafts[idx];
}

export function removeDraft(id) {
  const data = read();
  data.drafts = (data.drafts || []).filter((d) => d.id !== id);
  write(data);
}

export function reload() {
  return read();
}

export const __testing = { DRAFTS_PATH };
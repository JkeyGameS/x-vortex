import logger from './logger.js';

/**
 * Baileys group metadata helpers.
 *
 * groupMetadata() is a network round trip and is called on every group message,
 * so results are cached per group for METADATA_TTL_MS. The cache is
 * deliberately not persisted: participant lists are runtime state.
 */

const metadataCache = new Map();
const METADATA_TTL_MS = 5 * 60 * 1000;

/**
 * @returns {Promise<object|null>} raw Baileys group metadata, or null on failure
 */
export async function getGroupMetadata(sock, groupJid) {
  if (!sock || typeof sock.groupMetadata !== 'function') return null;
  const cached = metadataCache.get(groupJid);
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) return cached.data;
  try {
    const data = await sock.groupMetadata(groupJid);
    metadataCache.set(groupJid, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    logger.warn({ err, groupJid }, '[GROUP] metadata fetch failed');
    return null;
  }
}

/** Drop a cached entry, e.g. after the bot is added to or removed from a group. */
export function invalidateGroupMetadata(groupJid) {
  metadataCache.delete(groupJid);
}

export function clearGroupMetadataCache() {
  metadataCache.clear();
}

/** True when userJid is an admin or superadmin of groupJid. */
export async function isGroupAdmin(sock, groupJid, userJid) {
  if (!userJid) return false;
  const meta = await getGroupMetadata(sock, groupJid);
  if (!meta || !Array.isArray(meta.participants)) return false;
  const p = meta.participants.find((x) => x && x.id === userJid);
  return !!(p && (p.admin === 'admin' || p.admin === 'superadmin'));
}

/**
 * Refresh the stats-backed live member count for a group.
 *
 * Called on activation and whenever the stats panel opens, so the counter
 * self-heals if a join or leave was missed (for example while the bot was
 * offline). Best-effort: returns null when metadata is unavailable.
 *
 * @returns {Promise<number|null>}
 */
export async function syncMemberCount(sock, groupJid) {
  try {
    const meta = await getGroupMetadata(sock, groupJid);
    const n = meta?.participants?.length;
    if (!Number.isFinite(n)) return null;
    const { setMemberCount } = await import('../services/groupStatsService.js');
    return setMemberCount(groupJid, n);
  } catch (err) {
    logger.warn({ err, groupJid }, '[GROUP] member count sync failed');
    return null;
  }
}
/** True when the bot itself is an admin of the group. */
export async function isBotGroupAdmin(sock, groupJid, botJid) {
  const id = botJid || sock?.user?.id;
  if (!id) return false;
  return isGroupAdmin(sock, groupJid, id);
}

export async function getMemberCount(sock, groupJid) {
  const meta = await getGroupMetadata(sock, groupJid);
  return meta?.participants?.length || 0;
}

/** Every group the bot participates in. Used to build the DM picker. */
export async function listBotGroups(sock) {
  if (!sock || typeof sock.groupFetchAllParticipating !== 'function') return [];
  try {
    const map = await sock.groupFetchAllParticipating();
    return Object.values(map || {});
  } catch (err) {
    logger.warn({ err }, '[GROUP] failed to list bot groups');
    return [];
  }
}
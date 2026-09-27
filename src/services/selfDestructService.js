import logger from '../utils/logger.js';
import { getUserByJid, updateUser } from './userService.js';

/**
 * Queue to store pending self-destruct message deletions.
 * Key: `${jid}:${messageKey.id}`
 * Value: { jid, messageKey, scheduledTime, attemptCount }
 */
const pendingDeletions = new Map();

/**
 * Current socket reference - updated when bot connects/reconnects
 */
let currentSock = null;

/**
 * Connection state flag - updated by socket connection events
 */
let isSocketConnected = false;

const MAX_ATTEMPTS = 5;
const ATTEMPT_DELAY_MS = 2000; // Start with 2s between attempts

export function setSock(sock) {
  currentSock = sock;
  
  if (!sock) {
    isSocketConnected = false;
    return;
  }

  // Listen for connection updates from the socket
  if (sock.ev) {
    sock.ev.on('connection.update', (update) => {
      const { connection } = update;
      if (connection === 'open') {
        isSocketConnected = true;
        logger.info({ pendingCount: pendingDeletions.size }, 'Self-destruct service: connection open, will process pending deletions');
        // Process all pending deletions now that we're connected
        processPendingDeletions();
      } else if (connection === 'close') {
        isSocketConnected = false;
        logger.debug('Self-destruct service: connection closed');
      }
    });
  }
}

export function formatDuration(seconds) {
  if (!seconds) return '0 seconds';
  const units = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1]
  ];
  for (const [name, size] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }
  return `${seconds} seconds`;
}

/**
 * Check if the socket is properly connected and ready to send messages
 * Uses the connection state flag plus socket validation
 */
function isConnectionReady() {
  // Must have: user authenticated, ws connection, ws in OPEN state, and connection flag set
  return isSocketConnected && 
         currentSock?.user && 
         currentSock?.ws && 
         currentSock.ws.readyState === 1;
}

/**
 * Attempt to delete a message using the current socket
 */
async function attemptDeletion(pendingKey, jid, messageKey, attemptCount) {
  try {
    if (!isConnectionReady()) {
      logger.debug({
        jid,
        messageKeyId: messageKey.id,
        attemptCount,
        connectionReady: isConnectionReady(),
        hasUser: !!currentSock?.user,
        hasWs: !!currentSock?.ws,
        wsReadyState: currentSock?.ws?.readyState,
        socketConnected: isSocketConnected
      }, 'Cannot delete: connection not ready');
      return false;
    }

    await currentSock.sendMessage(jid, { delete: messageKey });
    
    // Success: remove from pending queue
    pendingDeletions.delete(pendingKey);
    logger.info({ 
      jid, 
      messageKeyId: messageKey.id, 
      attemptCount 
    }, 'Self-destruct message deleted successfully');
    return true;
  } catch (err) {
    logger.warn({
      err,
      jid,
      messageKeyId: messageKey.id,
      attemptCount
    }, 'Self-destruct deletion attempt failed');
    return false;
  }
}

/**
 * Process all pending self-destruct deletions using the current socket
 * Attempts each one, with exponential backoff if the connection isn't ready
 */
async function processPendingDeletions() {
  if (pendingDeletions.size === 0) {
    return;
  }

  logger.debug({ count: pendingDeletions.size }, 'Processing pending self-destruct deletions');

  for (const [pendingKey, entry] of Array.from(pendingDeletions.entries())) {
    const { jid, messageKey, attemptCount } = entry;

    // Skip if max attempts exceeded
    if (attemptCount >= MAX_ATTEMPTS) {
      pendingDeletions.delete(pendingKey);
      logger.error({
        jid,
        messageKeyId: messageKey.id,
        attemptCount,
        maxAttempts: MAX_ATTEMPTS
      }, 'Self-destruct deletion failed: max attempts exceeded');
      continue;
    }

    const success = await attemptDeletion(pendingKey, jid, messageKey, attemptCount);
    
    if (!success) {
      // Update entry for next retry
      entry.attemptCount++;
      entry.lastAttemptTime = Date.now();

      // Calculate exponential backoff delay
      const delayMs = ATTEMPT_DELAY_MS * Math.pow(2, entry.attemptCount - 1);

      logger.debug({
        jid,
        messageKeyId: messageKey.id,
        attemptCount: entry.attemptCount,
        maxAttempts: MAX_ATTEMPTS,
        nextRetryDelayMs: delayMs
      }, 'Self-destruct deletion will retry');

      // Schedule the next retry
      setTimeout(() => {
        processPendingDeletions();
      }, delayMs);
    }
  }
}

/**
 * Get current pending deletions count (for diagnostics)
 */
export function getPendingDeletionsCount() {
  return pendingDeletions.size;
}

/**
 * Get detailed pending deletions info (for debugging)
 */
export function getPendingDeletionsInfo() {
  return Array.from(pendingDeletions.entries()).map(([key, entry]) => ({
    key,
    ...entry,
    timeSinceScheduled: Date.now() - entry.scheduledTime
  }));
}

export async function scheduleSelfDestruct(sock, jid, messageKey, consume = true) {
  if (!messageKey) return;
  
  const user = await getUserByJid(jid);
  const setting = user?.preferences?.selfDestruct;
  if (!setting?.enabled || !setting.durationSeconds) return;

  const remaining = Number(setting.remainingCount);
  if (remaining !== -1 && (!Number.isInteger(remaining) || remaining < 1)) return;

  if (consume && remaining !== -1) {
    const preferences = {
      ...(user.preferences || {}),
      selfDestruct: {
        ...setting,
        remainingCount: remaining - 1,
        enabled: remaining - 1 > 0
      }
    };
    await updateUser(jid, { preferences });
  }

  const pendingKey = `${jid}:${messageKey.id}`;

  // Avoid scheduling the same message twice
  if (pendingDeletions.has(pendingKey)) {
    logger.debug({ jid, messageKeyId: messageKey.id }, 'Self-destruct already scheduled for this message');
    return;
  }

  // Add to pending queue
  pendingDeletions.set(pendingKey, {
    jid,
    messageKey,
    scheduledTime: Date.now(),
    lastAttemptTime: null,
    attemptCount: 0
  });

  logger.debug({
    jid,
    messageKeyId: messageKey.id,
    durationSeconds: setting.durationSeconds
  }, 'Scheduled self-destruct message deletion');

  // Schedule the initial deletion attempt
  // Use current socket reference, not the captured one
  setTimeout(async () => {
    await processPendingDeletions();
  }, setting.durationSeconds * 1000);
}

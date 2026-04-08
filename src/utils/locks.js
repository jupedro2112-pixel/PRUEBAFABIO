const { getRedisClient } = require('./redisClient');

const refundLocksMemory = new Map();
const cbuRequestTimestampsMemory = new Map();

const CBU_RATE_WINDOW_MS = 10000;

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of refundLocksMemory.entries()) {
    if (now - timestamp > 5 * 60 * 1000) refundLocksMemory.delete(key);
  }
}, 60 * 1000);

setInterval(() => {
  const cutoff = Date.now() - CBU_RATE_WINDOW_MS * 2;
  for (const [userId, ts] of cbuRequestTimestampsMemory.entries()) {
    if (ts < cutoff) cbuRequestTimestampsMemory.delete(userId);
  }
}, 30 * 1000);

async function acquireRefundLock(userId, type) {
  const key = `refund-lock:${userId}:${type}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      const result = await redis.set(key, '1', { NX: true, EX: 300 });
      return result === 'OK';
    } catch (err) {
      // fallback to memory
    }
  }
  if (refundLocksMemory.has(key)) return false;
  refundLocksMemory.set(key, Date.now());
  return true;
}

async function releaseRefundLock(userId, type) {
  const key = `refund-lock:${userId}:${type}`;
  const redis = getRedisClient();
  if (redis) {
    try { await redis.del(key); } catch (err) { /* ignore */ }
  }
  refundLocksMemory.delete(key);
}

function checkCbuRateLimit(userId) {
  const last = cbuRequestTimestampsMemory.get(userId);
  const now = Date.now();
  if (last && now - last < CBU_RATE_WINDOW_MS) return false;
  cbuRequestTimestampsMemory.set(userId, now);
  return true;
}

module.exports = { acquireRefundLock, releaseRefundLock, checkCbuRateLimit, refundLocksMemory, cbuRequestTimestampsMemory };

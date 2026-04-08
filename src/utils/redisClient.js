let _redisClient = null;

function setRedisClient(client) {
  _redisClient = client;
}

function getRedisClient() {
  if (_redisClient && _redisClient.isReady) {
    return _redisClient;
  }
  return null;
}

module.exports = { setRedisClient, getRedisClient };

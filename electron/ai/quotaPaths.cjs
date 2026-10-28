const path = require('node:path');

const AI_QUOTA_DIRECTORY_NAME = 'ai-free-tier-quota';
const AI_QUOTA_FILE_NAME = 'ai-free-tier-quota.v1.json';

function resolveAIQuotaPaths(options = {}) {
  const { userDataPath } = options;
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('Lokasi userData kuota AI harus absolut');
  }
  const directoryPath = path.join(userDataPath, AI_QUOTA_DIRECTORY_NAME);
  return Object.freeze({ directoryPath, filePath: path.join(directoryPath, AI_QUOTA_FILE_NAME) });
}

module.exports = {
  AI_QUOTA_DIRECTORY_NAME,
  AI_QUOTA_FILE_NAME,
  resolveAIQuotaPaths,
};

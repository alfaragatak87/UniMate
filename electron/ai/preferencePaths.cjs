const path = require('node:path');

const AI_PREFERENCE_DIRECTORY_NAME = 'ai-preferences';
const AI_PREFERENCE_FILE_NAME = 'ai-preferences.v1.json';

function resolveAIPreferencePaths(options = {}) {
  const { userDataPath } = options;
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('Lokasi userData preferensi AI harus absolut');
  }
  const directoryPath = path.join(userDataPath, AI_PREFERENCE_DIRECTORY_NAME);
  return Object.freeze({ directoryPath, filePath: path.join(directoryPath, AI_PREFERENCE_FILE_NAME) });
}

module.exports = {
  AI_PREFERENCE_DIRECTORY_NAME,
  AI_PREFERENCE_FILE_NAME,
  resolveAIPreferencePaths,
};

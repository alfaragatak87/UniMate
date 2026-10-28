const path = require('node:path');

const AI_BUDGET_DIRECTORY_NAME = 'ai-budget';
const AI_BUDGET_FILE_NAME = 'ai-budget-ledger.v1.json';

function resolveAIBudgetPaths(options = {}) {
  const { userDataPath } = options;
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('Lokasi userData budget AI harus absolut');
  }
  const directoryPath = path.join(userDataPath, AI_BUDGET_DIRECTORY_NAME);
  return Object.freeze({
    directoryPath,
    filePath: path.join(directoryPath, AI_BUDGET_FILE_NAME),
  });
}

module.exports = {
  AI_BUDGET_DIRECTORY_NAME,
  AI_BUDGET_FILE_NAME,
  resolveAIBudgetPaths,
};

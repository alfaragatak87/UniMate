const path = require('node:path');

const {
  CREDENTIAL_DIRECTORY_NAME,
  CREDENTIAL_FILE_NAME,
} = require('./constants.cjs');

function resolveCredentialPaths(options = {}) {
  const { userDataPath } = options;
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('Lokasi userData credential harus absolut');
  }

  const directoryPath = path.join(userDataPath, CREDENTIAL_DIRECTORY_NAME);
  return Object.freeze({
    userDataPath,
    directoryPath,
    filePath: path.join(directoryPath, CREDENTIAL_FILE_NAME),
  });
}

module.exports = {
  resolveCredentialPaths,
};

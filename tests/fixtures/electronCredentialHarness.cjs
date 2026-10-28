const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, safeStorage } = require('electron');

const { createElectronCredentialRuntime } = require('../../electron/credentials/credentialRuntime.cjs');

function readArgument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

function assertContainedPath(parentPath, childPath) {
  const resolvedParent = path.resolve(parentPath);
  const resolvedChild = path.resolve(childPath);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error('invalid_test_path');
  }
}

async function loadFixtures() {
  const fixturePath = path.join(__dirname, 'credentialFixtures.mjs');
  return import(pathToFileURL(fixturePath).href);
}

async function writeResult(resultPath, result) {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify(result), 'utf8');
}

async function runOperation(operation, service, fixtures) {
  if (operation === 'configure') {
    const configured = await service.configure(fixtures.SYNTHETIC_OPENAI_MUTATION);
    return { ok: configured.configured === true, replaced: configured.replaced };
  }
  if (operation === 'verify-initial') {
    const verified = await service.withCredential('openai', credential => ({
      matches: credential === fixtures.SYNTHETIC_OPENAI_CREDENTIAL,
    }));
    return { ok: verified.matches === true };
  }
  if (operation === 'replace') {
    const request = fixtures.clone(fixtures.SYNTHETIC_OPENAI_MUTATION);
    request.credential = fixtures.SYNTHETIC_OPENAI_REPLACEMENT;
    const configured = await service.configure(request);
    return { ok: configured.configured === true, replaced: configured.replaced };
  }
  if (operation === 'verify-replacement') {
    const verified = await service.withCredential('openai', credential => ({
      matches: credential === fixtures.SYNTHETIC_OPENAI_REPLACEMENT,
    }));
    return { ok: verified.matches === true };
  }
  if (operation === 'verify-corrupt') {
    try {
      await service.withCredential('openai', () => ({ ok: true }));
      return { ok: false, rejected: false };
    } catch (error) {
      return {
        ok: error?.code === 'decryption_failed' || error?.code === 'storage_corrupt',
        rejected: true,
        code: error?.code === 'storage_corrupt' ? 'storage_corrupt' : 'decryption_failed',
      };
    }
  }
  throw new Error('invalid_test_operation');
}

async function main() {
  const operation = readArgument('operation');
  const profilePath = readArgument('profile');
  const resultPath = readArgument('result');
  if (!operation || !profilePath || !resultPath || !path.isAbsolute(profilePath) || !path.isAbsolute(resultPath)) {
    throw new Error('invalid_test_arguments');
  }
  assertContainedPath(profilePath, resultPath);

  app.setPath('userData', profilePath);
  await app.whenReady();

  globalThis.fetch = async () => {
    throw new Error('network_disabled');
  };

  const fixtures = await loadFixtures();
  const runtime = createElectronCredentialRuntime({ app, safeStorage });
  const result = await runOperation(operation, runtime.service, fixtures);
  await writeResult(resultPath, result);
}

main()
  .then(() => app.exit(0))
  .catch(async error => {
    const profilePath = readArgument('profile');
    const resultPath = readArgument('result');
    if (profilePath && resultPath) {
      try {
        assertContainedPath(profilePath, resultPath);
        await writeResult(resultPath, { ok: false, code: error?.code ?? 'harness_failed' });
      } catch {}
    }
    app.exit(1);
  });

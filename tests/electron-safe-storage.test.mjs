import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import constants from '../electron/credentials/constants.cjs';
import {
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_REPLACEMENT,
} from './fixtures/credentialFixtures.mjs';

const { CREDENTIAL_DIRECTORY_NAME, CREDENTIAL_FILE_NAME } = constants;
const electronExecutable = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(process.cwd(), 'tests', 'fixtures', 'electronCredentialHarness.cjs');
const syntheticSecrets = [SYNTHETIC_OPENAI_CREDENTIAL, SYNTHETIC_OPENAI_REPLACEMENT];
const electronTestLockPath = path.join(process.cwd(), 'node_modules', '.unimate-electron-test.lock');

function assertNoSecret(value) {
  for (const secret of syntheticSecrets) {
    assert.equal(value.includes(secret), false);
  }
  assert.equal(value.includes('"ciphertext"'), false);
}

function tamperBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  bytes[bytes.length - 1] ^= 1;
  return bytes.toString('base64');
}

async function removeTestDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function acquireElectronTestLock() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(electronTestLockPath);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(electronTestLockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('electron_test_lock_timeout');
}

test('Electron safeStorage bertahan lintas proses dalam profil terisolasi', { timeout: 120_000 }, async () => {
  const releaseElectronTestLock = await acquireElectronTestLock();
  let rootPath;
  try {
  rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'unimate-m3b-electron-'));
  const profilePath = path.join(rootPath, 'isolated-user-data');
  const resultDirectory = path.join(profilePath, 'test-results');
  const credentialPath = path.join(profilePath, CREDENTIAL_DIRECTORY_NAME, CREDENTIAL_FILE_NAME);
  const activeChildren = new Set();
  let cleaned = false;

  async function runElectron(operation) {
    const resultPath = path.join(resultDirectory, `${operation}.json`);
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronExecutable, [
      harnessPath,
      `--operation=${operation}`,
      `--profile=${profilePath}`,
      `--result=${resultPath}`,
    ], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });

    let timeoutId;
    try {
      const exitCode = await new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          child.kill();
          reject(new Error('Electron test timeout'));
        }, 30_000);
        child.once('error', reject);
        child.once('close', resolve);
      });
      assertNoSecret(stdout);
      assertNoSecret(stderr);
      assert.equal(exitCode, 0);
      const serialized = await fs.readFile(resultPath, 'utf8');
      assertNoSecret(serialized);
      const result = JSON.parse(serialized);
      assert.equal(result.ok, true);
      return result;
    } finally {
      clearTimeout(timeoutId);
      if (child.exitCode === null) child.kill();
      activeChildren.delete(child);
    }
  }

  try {
    const configured = await runElectron('configure');
    assert.equal(configured.replaced, false);

    const storedInitial = await fs.readFile(credentialPath, 'utf8');
    for (const secret of syntheticSecrets) assert.equal(storedInitial.includes(secret), false);
    const initialHash = createHash('sha256').update(storedInitial).digest('hex');
    assert.equal(initialHash.length, 64);

    await runElectron('verify-initial');
    const replaced = await runElectron('replace');
    assert.equal(replaced.replaced, true);
    await runElectron('verify-replacement');

    const envelope = JSON.parse(await fs.readFile(credentialPath, 'utf8'));
    envelope.records.openai.ciphertext = tamperBase64(envelope.records.openai.ciphertext);
    const corrupted = JSON.stringify(envelope);
    await fs.writeFile(credentialPath, corrupted, 'utf8');
    const corruptResult = await runElectron('verify-corrupt');
    assert.equal(corruptResult.rejected, true);
    assert.equal(await fs.readFile(credentialPath, 'utf8'), corrupted);

    assert.equal(activeChildren.size, 0);
    await removeTestDirectory(rootPath);
    cleaned = true;
    await assert.rejects(fs.access(rootPath), error => error.code === 'ENOENT');
  } finally {
    for (const child of activeChildren) {
      if (child.exitCode === null) child.kill();
    }
    activeChildren.clear();
    if (!cleaned) await removeTestDirectory(rootPath);
  }
  } finally {
    await releaseElectronTestLock();
  }
});

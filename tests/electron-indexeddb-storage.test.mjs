import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const electronExecutable = path.join(repositoryRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const harnessPath = path.join(repositoryRoot, 'tests', 'fixtures', 'electronIndexedDBHarness.cjs');
const nodeModulesPath = path.join(repositoryRoot, 'node_modules');
const electronTestLockPath = path.join(nodeModulesPath, '.unimate-electron-test.lock');

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContained(parentPath, childPath) {
  const parent = normalized(parentPath);
  const child = normalized(childPath);
  assert.equal(child === parent || child.startsWith(`${parent}${path.sep}`), true);
}

function sanitizedFailure(value, rootPath) {
  return String(value)
    .replaceAll(rootPath, '<isolated-path>')
    .replace(/[A-Za-z]:[\\/][^\r\n"'`]*/gu, '<private-path>')
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-8)
    .join(' | ')
    .slice(0, 1200);
}

async function readCompletedResult(resultPath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const serialized = await fs.readFile(resultPath, 'utf8');
      if (serialized.length > 0) return JSON.parse(serialized);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise(resolve => killer.once('close', resolve));
    return;
  }
  child.kill('SIGKILL');
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

test('Chromium IndexedDB persisten lintas restart dalam profil Electron terisolasi', { timeout: 180_000 }, async () => {
  await fs.access(electronExecutable);
  const releaseElectronTestLock = await acquireElectronTestLock();
  let rootPath;
  let isolatedElectronExecutable;
  try {
    rootPath = await fs.mkdtemp(path.join(repositoryRoot, 'node_modules', '.unimate-indexeddb-'));
    isolatedElectronExecutable = path.join(
      path.dirname(electronExecutable),
      `.unimate-indexeddb-${process.pid}-${path.basename(rootPath)}.exe`,
    );
    await fs.link(electronExecutable, isolatedElectronExecutable);
  const paths = {
    profile: path.join(rootPath, 'profile'),
    results: path.join(rootPath, 'results'),
    staging: path.join(rootPath, 'staging'),
  };
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[name];
  }
  assert.equal(
    Object.keys(environment).some(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),
    false,
  );
  const activeChildren = new Set();

  async function run(operation) {
    const resultPath = path.join(paths.results, `${operation}.json`);
    assertContained(rootPath, resultPath);
    const child = spawn(isolatedElectronExecutable, [
      `--user-data-dir=${paths.profile}`,
      paths.staging,
      `--isolation-root=${rootPath}`,
      `--profile=${paths.profile}`,
      `--result=${resultPath}`,
      `--operation=${operation}`,
    ], {
      cwd: paths.staging,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    let timeoutId;
    let exit;
    try {
      exit = await new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('electron_indexeddb_timeout')), 20_000);
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
    } finally {
      clearTimeout(timeoutId);
      await terminateProcessTree(child);
      activeChildren.delete(child);
    }
    const diagnostic = sanitizedFailure(`${stdout}\n${stderr}`, rootPath) || 'no_process_output';
    const result = await readCompletedResult(resultPath);
    assert.notEqual(result, null, `electron_indexeddb_result_incomplete_exit_${exit.code}_signal_${exit.signal ?? 'none'}:${diagnostic}`);
    assert.equal(result.ok, true, `${result.stage ?? 'unknown'}:${result.code ?? 'unknown'}`);
    assert.equal(exit.code, 0, `electron_indexeddb_exit_${exit.code}_signal_${exit.signal ?? 'none'}:${diagnostic}`);
    assertContained(rootPath, path.join(rootPath, ...result.userDataRelative.split('/')));
    return result;
  }

  try {
    await Promise.all(Object.values(paths).map(directory => fs.mkdir(directory, { recursive: true })));
    await fs.copyFile(harnessPath, path.join(paths.staging, 'main.cjs'));
    await fs.writeFile(path.join(paths.staging, 'package.json'), JSON.stringify({
      name: 'unimate-indexeddb-test',
      version: '1.0.0',
      private: true,
      main: 'main.cjs',
    }), 'utf8');
    const write = await run('write');
    const verification = await run('verify_suite');

    assert.equal(write.result.written, true);
    assert.deepEqual(verification.result, {
      found: true,
      valid: true,
      missing: true,
      rejected: true,
      originalPreserved: true,
      cancelledWriteAbsent: true,
    });
    assert.equal(verification.userDataRelative, write.userDataRelative);
    assert.equal(activeChildren.size, 0);
  } finally {
    for (const child of activeChildren) await terminateProcessTree(child);
    await fs.rm(rootPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  await assert.rejects(fs.access(rootPath), error => error.code === 'ENOENT');
  } finally {
    if (isolatedElectronExecutable) await fs.rm(isolatedElectronExecutable, { force: true });
    await releaseElectronTestLock();
  }
});

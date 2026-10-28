import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDENTIAL_CONTRACT_VERSION,
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_STATES,
  CREDENTIAL_STORAGE_STATES,
} from '../shared/credentials/contracts.mjs';
import {
  CREDENTIAL_CONFIGURATION_MODES,
  CREDENTIAL_MUTATION_OUTCOMES,
  CREDENTIAL_RESPONSE_OPERATIONS,
  CREDENTIAL_TRANSPORT_OPERATIONS,
  CREDENTIAL_TRANSPORT_VERSION,
} from '../shared/credentials/transportContracts.mjs';
import {
  assertValidCredentialTransportRequest,
  assertValidCredentialTransportResponse,
  validateCredentialTransportRequest,
  validateCredentialTransportResponse,
} from '../shared/credentials/transportValidation.mjs';
import controllerModule from '../electron/credentials/credentialController.cjs';
import {
  SYNTHETIC_GEMINI_CREDENTIAL,
  SYNTHETIC_OPENAI_CREDENTIAL,
  SYNTHETIC_OPENAI_REPLACEMENT,
} from './fixtures/credentialFixtures.mjs';

const { CredentialControllerError, createCredentialController } = controllerModule;

function statusRequest() {
  return { schemaVersion: CREDENTIAL_TRANSPORT_VERSION, operation: CREDENTIAL_TRANSPORT_OPERATIONS.STATUS };
}

function configureRequest(provider, mode, credential) {
  return {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_TRANSPORT_OPERATIONS.CONFIGURE,
    provider,
    mode,
    credential,
  };
}

function removeRequest(provider) {
  return {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_TRANSPORT_OPERATIONS.REMOVE,
    provider,
  };
}

function createMockCredentialService(options = {}) {
  const credentials = new Map(Object.entries(options.initialCredentials ?? {}));
  const calls = [];
  let storage = options.storage ?? CREDENTIAL_STORAGE_STATES.READY;

  function providerState(provider) {
    if (storage === CREDENTIAL_STORAGE_STATES.CORRUPT) return CREDENTIAL_STATES.CORRUPT;
    if (storage === CREDENTIAL_STORAGE_STATES.UNAVAILABLE) return CREDENTIAL_STATES.UNAVAILABLE;
    return credentials.has(provider) ? CREDENTIAL_STATES.CONFIGURED : CREDENTIAL_STATES.MISSING;
  }

  const service = Object.freeze({
    async getStatus() {
      calls.push({ operation: 'status' });
      if (options.statusError) throw options.statusError;
      if (options.statusResponse) return options.statusResponse;
      return {
        schemaVersion: CREDENTIAL_CONTRACT_VERSION,
        storage: credentials.size === 0 && storage === CREDENTIAL_STORAGE_STATES.READY
          ? CREDENTIAL_STORAGE_STATES.MISSING
          : storage,
        providers: {
          openai: providerState(CREDENTIAL_PROVIDERS.OPENAI),
          gemini: providerState(CREDENTIAL_PROVIDERS.GEMINI),
        },
      };
    },

    async configure(request) {
      calls.push({ operation: 'configure', provider: request.provider });
      if (options.beforeConfigure) await options.beforeConfigure(request);
      if (options.configureError) throw options.configureError;
      if (options.configureResponse) return options.configureResponse;
      const replaced = credentials.has(request.provider);
      credentials.set(request.provider, request.credential);
      storage = CREDENTIAL_STORAGE_STATES.READY;
      return { provider: request.provider, configured: true, replaced };
    },

    async remove(request) {
      calls.push({ operation: 'remove', provider: request.provider });
      if (options.beforeRemove) await options.beforeRemove(request);
      if (options.removeError) throw options.removeError;
      if (options.removeResponse) return options.removeResponse;
      const removed = credentials.delete(request.provider);
      return { provider: request.provider, configured: false, removed };
    },

    withCredential() {
      throw new Error('Jalur ini tidak boleh dipanggil controller');
    },
  });

  return { service, calls, credentials };
}

function createControllerHarness(options = {}) {
  const mock = createMockCredentialService(options);
  const confirmations = [];
  const confirmMutation = options.confirmMutation ?? (async confirmation => {
    confirmations.push(confirmation);
    return true;
  });
  const controller = createCredentialController({ credentialService: mock.service, confirmMutation });
  return { ...mock, confirmations, controller };
}

function assertSanitized(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    SYNTHETIC_OPENAI_CREDENTIAL,
    SYNTHETIC_OPENAI_REPLACEMENT,
    SYNTHETIC_GEMINI_CREDENTIAL,
    'ciphertext',
    'C:\\Users\\private-user',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
}

test('kontrak transport menerima request dan response aman yang valid', () => {
  const request = configureRequest(
    CREDENTIAL_PROVIDERS.OPENAI,
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_OPENAI_CREDENTIAL,
  );
  const response = {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
    outcome: CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
    changed: true,
  };
  assert.equal(validateCredentialTransportRequest(request).valid, true);
  assert.equal(validateCredentialTransportResponse(response).valid, true);
  assert.equal(assertValidCredentialTransportRequest(request), request);
  assert.equal(assertValidCredentialTransportResponse(response), response);
});

test('kontrak transport menolak field tambahan, provider, mode, dan panjang credential invalid', () => {
  const invalidRequests = [
    { ...statusRequest(), extra: true },
    configureRequest('unknown', CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    configureRequest(CREDENTIAL_PROVIDERS.OPENAI, 'upsert', SYNTHETIC_OPENAI_CREDENTIAL),
    configureRequest(CREDENTIAL_PROVIDERS.OPENAI, CREDENTIAL_CONFIGURATION_MODES.CREATE, 'short'),
    configureRequest(CREDENTIAL_PROVIDERS.OPENAI, CREDENTIAL_CONFIGURATION_MODES.CREATE, 'x'.repeat(4097)),
    { ...removeRequest(CREDENTIAL_PROVIDERS.OPENAI), mode: CREDENTIAL_CONFIGURATION_MODES.CREATE },
  ];
  for (const request of invalidRequests) assert.equal(validateCredentialTransportRequest(request).valid, false);
});

test('kontrak response menolak kebocoran dan semantik pembatalan yang salah', () => {
  const leaked = {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_RESPONSE_OPERATIONS.REMOVE,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
    outcome: CREDENTIAL_MUTATION_OUTCOMES.CANCELLED,
    changed: true,
    ciphertext: 'synthetic-ciphertext',
  };
  assert.equal(validateCredentialTransportResponse(leaked).valid, false);
});

test('controller hanya mengekspos execute dan status tanpa secret', async () => {
  const harness = createControllerHarness({
    initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
  });
  assert.deepEqual(Object.keys(harness.controller), ['execute']);
  assert.equal(harness.controller.withCredential, undefined);
  const response = await harness.controller.execute(statusRequest());
  assert.deepEqual(response, {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_RESPONSE_OPERATIONS.STATUS,
    status: {
      schemaVersion: CREDENTIAL_CONTRACT_VERSION,
      storage: CREDENTIAL_STORAGE_STATES.READY,
      providers: { openai: CREDENTIAL_STATES.CONFIGURED, gemini: CREDENTIAL_STATES.MISSING },
    },
  });
  assertSanitized(response);
});

test('konfigurasi pertama memakai konfirmasi configure dan respons aman', async () => {
  const harness = createControllerHarness();
  const response = await harness.controller.execute(configureRequest(
    CREDENTIAL_PROVIDERS.OPENAI,
    CREDENTIAL_CONFIGURATION_MODES.CREATE,
    SYNTHETIC_OPENAI_CREDENTIAL,
  ));
  assert.deepEqual(harness.confirmations, [{ action: 'configure', provider: CREDENTIAL_PROVIDERS.OPENAI }]);
  assert.deepEqual(response, {
    schemaVersion: CREDENTIAL_TRANSPORT_VERSION,
    operation: CREDENTIAL_RESPONSE_OPERATIONS.CONFIGURE,
    provider: CREDENTIAL_PROVIDERS.OPENAI,
    outcome: CREDENTIAL_MUTATION_OUTCOMES.COMPLETED,
    changed: true,
  });
  assert.equal(harness.credentials.get(CREDENTIAL_PROVIDERS.OPENAI), SYNTHETIC_OPENAI_CREDENTIAL);
  assertSanitized(response);
});

test('penggantian memakai konfirmasi replace yang berbeda', async () => {
  const harness = createControllerHarness({
    initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
  });
  const response = await harness.controller.execute(configureRequest(
    CREDENTIAL_PROVIDERS.OPENAI,
    CREDENTIAL_CONFIGURATION_MODES.REPLACE,
    SYNTHETIC_OPENAI_REPLACEMENT,
  ));
  assert.deepEqual(harness.confirmations, [{ action: 'replace', provider: CREDENTIAL_PROVIDERS.OPENAI }]);
  assert.equal(response.operation, CREDENTIAL_RESPONSE_OPERATIONS.REPLACE);
  assert.equal(harness.credentials.get(CREDENTIAL_PROVIDERS.OPENAI), SYNTHETIC_OPENAI_REPLACEMENT);
  assertSanitized(response);
});

test('penghapusan memakai konfirmasi remove dan tidak memengaruhi provider lain', async () => {
  const harness = createControllerHarness({
    initialCredentials: {
      openai: SYNTHETIC_OPENAI_CREDENTIAL,
      gemini: SYNTHETIC_GEMINI_CREDENTIAL,
    },
  });
  const response = await harness.controller.execute(removeRequest(CREDENTIAL_PROVIDERS.OPENAI));
  assert.deepEqual(harness.confirmations, [{ action: 'remove', provider: CREDENTIAL_PROVIDERS.OPENAI }]);
  assert.equal(response.changed, true);
  assert.equal(harness.credentials.has(CREDENTIAL_PROVIDERS.OPENAI), false);
  assert.equal(harness.credentials.get(CREDENTIAL_PROVIDERS.GEMINI), SYNTHETIC_GEMINI_CREDENTIAL);
  assertSanitized(response);
});

test('pembatalan configure, replace, dan remove tidak mengubah credential', async () => {
  const scenarios = [
    {
      initialCredentials: {},
      request: configureRequest(CREDENTIAL_PROVIDERS.OPENAI, CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    },
    {
      initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
      request: configureRequest(CREDENTIAL_PROVIDERS.OPENAI, CREDENTIAL_CONFIGURATION_MODES.REPLACE, SYNTHETIC_OPENAI_REPLACEMENT),
    },
    {
      initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
      request: removeRequest(CREDENTIAL_PROVIDERS.OPENAI),
    },
  ];
  for (const scenario of scenarios) {
    const harness = createControllerHarness({
      initialCredentials: scenario.initialCredentials,
      confirmMutation: async () => false,
    });
    const before = [...harness.credentials.entries()];
    const response = await harness.controller.execute(scenario.request);
    assert.equal(response.outcome, CREDENTIAL_MUTATION_OUTCOMES.CANCELLED);
    assert.equal(response.changed, false);
    assert.deepEqual([...harness.credentials.entries()], before);
    assert.equal(harness.calls.some(call => ['configure', 'remove'].includes(call.operation)), false);
  }
});

test('request invalid ditolak sebelum konfirmasi atau akses service', async () => {
  const harness = createControllerHarness();
  const request = {
    ...configureRequest(CREDENTIAL_PROVIDERS.OPENAI, CREDENTIAL_CONFIGURATION_MODES.CREATE, SYNTHETIC_OPENAI_CREDENTIAL),
    extra: SYNTHETIC_OPENAI_CREDENTIAL,
  };
  await assert.rejects(
    harness.controller.execute(request),
    error => error instanceof CredentialControllerError && error.code === 'invalid_request',
  );
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.confirmations, []);
});

test('konfirmasi gagal ditolak tanpa mutasi dan tanpa memantulkan detail error', async () => {
  const harness = createControllerHarness({
    confirmMutation: async () => {
      throw new Error(`${SYNTHETIC_OPENAI_CREDENTIAL} C:\\Users\\private-user`);
    },
  });
  let captured;
  await assert.rejects(
    harness.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_OPENAI_CREDENTIAL,
    )),
    error => {
      captured = error;
      return error instanceof CredentialControllerError && error.code === 'confirmation_failed';
    },
  );
  assert.equal(harness.calls.some(call => call.operation === 'configure'), false);
  assertSanitized(captured);
});

test('state conflict mencegah create menimpa credential dan replace membuat credential baru', async () => {
  const existing = createControllerHarness({
    initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
  });
  await assert.rejects(
    existing.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_OPENAI_REPLACEMENT,
    )),
    error => error.code === 'state_conflict',
  );
  const missing = createControllerHarness();
  await assert.rejects(
    missing.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.REPLACE,
      SYNTHETIC_OPENAI_REPLACEMENT,
    )),
    error => error.code === 'state_conflict',
  );
  assert.equal(existing.credentials.get(CREDENTIAL_PROVIDERS.OPENAI), SYNTHETIC_OPENAI_CREDENTIAL);
  assert.equal(missing.credentials.size, 0);
});

test('error service dan respons service invalid disanitasi secara fail-closed', async () => {
  const unsafeError = new Error(`${SYNTHETIC_OPENAI_CREDENTIAL} C:\\Users\\private-user`);
  unsafeError.code = 'write_failed';
  const failed = createControllerHarness({ configureError: unsafeError });
  let captured;
  await assert.rejects(
    failed.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_OPENAI_CREDENTIAL,
    )),
    error => {
      captured = error;
      return error.code === 'operation_failed';
    },
  );
  assertSanitized(captured);

  const invalid = createControllerHarness({
    configureResponse: {
      provider: CREDENTIAL_PROVIDERS.OPENAI,
      configured: true,
      replaced: false,
      ciphertext: SYNTHETIC_OPENAI_CREDENTIAL,
    },
  });
  await assert.rejects(
    invalid.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_OPENAI_CREDENTIAL,
    )),
    error => error.code === 'invalid_service_response' && !error.message.includes(SYNTHETIC_OPENAI_CREDENTIAL),
  );
});

test('mutasi bersamaan diserialisasi sehingga replace selesai sebelum remove', async () => {
  let releaseConfigure;
  let configureStarted;
  const configureGate = new Promise(resolve => { releaseConfigure = resolve; });
  const started = new Promise(resolve => { configureStarted = resolve; });
  const harness = createControllerHarness({
    initialCredentials: { openai: SYNTHETIC_OPENAI_CREDENTIAL },
    beforeConfigure: async () => {
      configureStarted();
      await configureGate;
    },
  });

  const replacePromise = harness.controller.execute(configureRequest(
    CREDENTIAL_PROVIDERS.OPENAI,
    CREDENTIAL_CONFIGURATION_MODES.REPLACE,
    SYNTHETIC_OPENAI_REPLACEMENT,
  ));
  await started;
  const removePromise = harness.controller.execute(removeRequest(CREDENTIAL_PROVIDERS.OPENAI));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.some(call => call.operation === 'remove'), false);
  releaseConfigure();
  const [replaceResult, removeResult] = await Promise.all([replacePromise, removePromise]);
  assert.equal(replaceResult.operation, CREDENTIAL_RESPONSE_OPERATIONS.REPLACE);
  assert.equal(removeResult.operation, CREDENTIAL_RESPONSE_OPERATIONS.REMOVE);
  assert.deepEqual(
    harness.calls.filter(call => ['configure', 'remove'].includes(call.operation)).map(call => call.operation),
    ['configure', 'remove'],
  );
  assert.equal(harness.credentials.has(CREDENTIAL_PROVIDERS.OPENAI), false);
});

test('controller tidak menulis secret atau metadata credential ke console', async () => {
  const harness = createControllerHarness();
  const calls = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => calls.push(args);
  console.warn = (...args) => calls.push(args);
  console.error = (...args) => calls.push(args);
  try {
    await harness.controller.execute(configureRequest(
      CREDENTIAL_PROVIDERS.OPENAI,
      CREDENTIAL_CONFIGURATION_MODES.CREATE,
      SYNTHETIC_OPENAI_CREDENTIAL,
    ));
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.deepEqual(calls, []);
});

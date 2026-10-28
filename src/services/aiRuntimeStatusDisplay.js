export const AI_RUNTIME_READ_STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  UNREADABLE: 'unreadable',
})

const GATEWAY_STATE_LABELS = Object.freeze({
  disabled: 'nonaktif',
  idle: 'belum dimulai',
  starting: 'sedang dimulai',
  running: 'berjalan',
  unavailable: 'gagal berjalan',
  stopped: 'berhenti',
})

export function getAIRuntimeStatusDisplay(runtimeStatus, readState) {
  if (readState === AI_RUNTIME_READ_STATES.LOADING) {
    return Object.freeze({ gateway: 'memuat', production: 'memuat' })
  }
  if (readState !== AI_RUNTIME_READ_STATES.READY || runtimeStatus === null) {
    return Object.freeze({
      gateway: 'status tidak dapat dibaca',
      production: 'status tidak dapat dibaca',
    })
  }
  return Object.freeze({
    gateway: GATEWAY_STATE_LABELS[runtimeStatus.gateway?.state] ?? 'status tidak valid',
    production: runtimeStatus.productionEnabled === true ? 'aktif' : 'nonaktif',
  })
}

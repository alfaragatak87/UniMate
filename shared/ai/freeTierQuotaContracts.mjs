export const AI_FREE_TIER_QUOTA_SCHEMA_VERSION = 1;
export const AI_FREE_TIER_QUOTA_TIMEZONE = 'America/Los_Angeles';
export const AI_FREE_TIER_QUOTA_MAX_ENTRIES = 10_000;

export const AI_FREE_TIER_QUOTA_ENTRY_STATUS = Object.freeze({
  RESERVED: 'reserved',
  SETTLED: 'settled',
});

export const AI_FREE_TIER_QUOTA_OUTCOMES = Object.freeze([
  'success',
  'failed',
  'cancelled',
  'unknown',
]);

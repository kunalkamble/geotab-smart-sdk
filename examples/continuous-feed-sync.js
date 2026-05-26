'use strict';
/**
 * Example: Continuous data sync via GetFeed with proper version-token management.
 *
 * This is the right pattern for syncing data to an external database.
 * Key principles demonstrated:
 *  - Version tokens are persisted before processing (crash-safe)
 *  - fromDate is only used on the very first call (then discarded)
 *  - Multiple feeds run concurrently via multiCall
 *  - Adaptive polling: immediate when full, backoff when empty
 */

const { GeotabSDK } = require('../src');
const fs = require('fs');

const TOKEN_FILE = './feed-tokens.json';

const sdk = new GeotabSDK({
  username: process.env.GEOTAB_USER,
  password: process.env.GEOTAB_PASS,
  database: process.env.GEOTAB_DB,
  server:   process.env.GEOTAB_SERVER || 'my.geotab.com',
});

// ── Token persistence ─────────────────────────────────────────────────────
// In production use Redis, a database, or any durable store.
// The token MUST be saved before processing — if you process then crash,
// you'll lose those records on restart.

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { return {}; }
}

function saveToken(entityType, token) {
  const tokens = loadTokens();
  tokens[entityType] = token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  await sdk.connect();

  const savedTokens = loadTokens();
  console.log('Loaded saved tokens:', savedTokens);

  const feeds = sdk.feeds();

  // LogRecord — historical GPS points
  feeds.addFeed('LogRecord', {
    fromVersion: savedTokens['LogRecord'] || null,
    fromDate:    savedTokens['LogRecord'] ? null : new Date(Date.now() - 3_600_000), // last hour if no token
    resultsLimit: 50_000,
  });

  // StatusData — diagnostic sensor readings (fuel, aux inputs, odometer, etc.)
  feeds.addFeed('StatusData', {
    fromVersion: savedTokens['StatusData'] || null,
    fromDate:    savedTokens['StatusData'] ? null : new Date(Date.now() - 3_600_000),
  });

  // FaultData — fault codes / DTCs
  feeds.addFeed('FaultData', {
    fromVersion: savedTokens['FaultData'] || null,
    fromDate:    savedTokens['FaultData'] ? null : new Date(Date.now() - 3_600_000),
  });

  // ── CRITICAL: Save token BEFORE processing data ────────────────────────
  feeds.on('version', (entityType, token) => {
    saveToken(entityType, token);
    console.log(`[version] ${entityType}: ${token}`);
  });

  // ── Process incoming data ──────────────────────────────────────────────
  feeds.on('data', (entityType, records) => {
    console.log(`[data] ${entityType}: ${records.length} records`);

    switch (entityType) {
      case 'LogRecord':
        syncGPS(records);
        break;
      case 'StatusData':
        syncDiagnostics(records);
        break;
      case 'FaultData':
        syncFaults(records);
        break;
    }
  });

  feeds.on('error', (entityType, err) => {
    console.error(`[error] ${entityType}:`, err.message);
    // FeedManager will automatically back off and retry
  });

  feeds.start();
  console.log('Feed manager running. Ctrl+C to stop.');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping feeds...');
    feeds.stop();
    process.exit(0);
  });
}

// ── Sync functions (replace with your DB writes) ──────────────────────────

function syncGPS(records) {
  // records[i]: { dateTime, latitude, longitude, speed, device: { id } }
  const validRecords = records.filter(r => r.speed !== -1); // skip InvalidSpeed
  console.log(`  GPS: ${validRecords.length} valid points (${records.length - validRecords.length} invalid speed filtered)`);
  // db.gps.insertMany(validRecords);
}

function syncDiagnostics(records) {
  // records[i]: { dateTime, data, device: { id }, diagnostic: { id } }
  // Note: diagnostic is only the ID stub — use EntityCache to resolve names
  const byType = {};
  for (const r of records) {
    const diagId = r.diagnostic?.id ?? 'unknown';
    byType[diagId] = (byType[diagId] || 0) + 1;
  }
  for (const [id, count] of Object.entries(byType)) {
    console.log(`  StatusData: ${count} readings for ${id}`);
  }
  // db.diagnostics.insertMany(records);
}

function syncFaults(records) {
  // records[i]: { dateTime, faultState, diagnostic, device: { id }, ... }
  const active = records.filter(r => r.faultState === 'Active');
  console.log(`  Faults: ${records.length} total, ${active.length} active`);
  // db.faults.insertMany(records);
}

main().catch(err => { console.error(err); process.exit(1); });

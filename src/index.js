'use strict';

const GeotabSDK = require('./GeotabSDK');
const { Diagnostics, DiagnosticLabels, DiagnosticGroups } = require('./constants/Diagnostics');
const FeedManager     = require('./feeds/FeedManager');
const LiveTracker     = require('./trackers/LiveTracker');
const RealtimeTracker = require('./trackers/RealtimeTracker');
const HistoryQuery    = require('./queries/HistoryQuery');
const FleetSnapshot   = require('./queries/FleetSnapshot');

module.exports = {
  // Primary entry point
  GeotabSDK,

  // Diagnostic ID constants
  Diagnostics,
  DiagnosticLabels,
  DiagnosticGroups,

  // Class exports for advanced use / extension
  FeedManager,
  LiveTracker,
  RealtimeTracker,
  HistoryQuery,
  FleetSnapshot,
};

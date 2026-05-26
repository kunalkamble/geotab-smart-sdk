'use strict';
/**
 * Diagnostic-constants tests — guards against accidental rename/drift of
 * the well-known Geotab KnownId strings the SDK exposes.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../src');

test('Diagnostic constants match Geotab KnownIds', () => {
  assert.equal(sdk.Diagnostics.FUEL_LEVEL,    'DiagnosticFuelLevelId');
  assert.equal(sdk.Diagnostics.ODOMETER,      'DiagnosticOdometerAdjustmentId');
  assert.equal(sdk.Diagnostics.ENGINE_RPM,    'DiagnosticEngineSpeedId');
  assert.equal(sdk.Diagnostics.ENGINE_SPEED,  'DiagnosticEngineRoadSpeedId');
  assert.equal(sdk.Diagnostics.IGNITION,      'DiagnosticIgnitionId');
  assert.equal(sdk.Diagnostics.AUX_INPUT_1,   'DiagnosticGoInputStatusId');
});

test('DiagnosticGroups expose expected arrays', () => {
  assert.ok(Array.isArray(sdk.DiagnosticGroups.FLEET_BASICS));
  assert.ok(sdk.DiagnosticGroups.FLEET_BASICS.includes(sdk.Diagnostics.FUEL_LEVEL));
  assert.ok(Array.isArray(sdk.DiagnosticGroups.AUX_INPUTS));
  assert.ok(sdk.DiagnosticGroups.AUX_INPUTS.length >= 4);
});

test('DiagnosticLabels provides reverse lookup', () => {
  assert.ok(sdk.DiagnosticLabels[sdk.Diagnostics.FUEL_LEVEL]);
});

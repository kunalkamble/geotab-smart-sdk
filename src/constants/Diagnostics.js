'use strict';

/**
 * Named constants for frequently used Geotab Diagnostic IDs.
 *
 * Without these, developers must memorise opaque strings like
 * 'DiagnosticGoInputStatusId' — this registry makes code self-documenting.
 *
 * Usage:
 *   const { Diagnostics } = require('geotab-smart-sdk');
 *   search: { diagnosticSearch: { id: Diagnostics.FUEL_LEVEL } }
 *
 * Units are noted in comments. Convert where needed:
 *   Odometer:     metres    → km:  value / 1000
 *   Engine hours: seconds   → h:   value / 3600
 *   Speed:        km/h      (no conversion needed)
 */
const Diagnostics = {
  // ── Aux / Digital inputs ─────────────────────────────────────────────────
  /** Aux input 1 — binary (0 = off, 1 = on) */
  AUX_INPUT_1:       'DiagnosticGoInputStatusId',
  /** Aux input 2 — binary */
  AUX_INPUT_2:       'DiagnosticGoInputStatus2Id',
  /** Aux input 3 — binary */
  AUX_INPUT_3:       'DiagnosticGoInputStatus3Id',
  /** Aux input 4 — binary */
  AUX_INPUT_4:       'DiagnosticGoInputStatus4Id',
  /** Aux input 5 — binary */
  AUX_INPUT_5:       'DiagnosticGoInputStatus5Id',
  /** Aux input 6 — binary */
  AUX_INPUT_6:       'DiagnosticGoInputStatus6Id',

  // ── Engine & powertrain ─────────────────────────────────────────────────
  /** Engine hours — seconds. Divide by 3600 for hours. */
  ENGINE_HOURS:      'DiagnosticEngineHoursAdjustmentId',
  /** Odometer — metres. Divide by 1000 for km. */
  ODOMETER:          'DiagnosticOdometerAdjustmentId',
  /** Engine speed — RPM */
  ENGINE_RPM:        'DiagnosticEngineSpeedId',
  /** Engine road speed — km/h */
  ENGINE_SPEED:      'DiagnosticEngineRoadSpeedId',
  /** Throttle position — % */
  THROTTLE_POSITION: 'DiagnosticThrottlePositionId',
  /** Engine load — % */
  ENGINE_LOAD:       'DiagnosticEngineLoadId',
  /** Engine coolant temperature — °C */
  COOLANT_TEMP:      'DiagnosticEngineCoolantTemperatureId',
  /** Oil temperature — °C */
  OIL_TEMP:          'DiagnosticTransmissionOilTemperatureId',
  /** Oil pressure — kPa */
  OIL_PRESSURE:      'DiagnosticOilPressureId',

  // ── Fuel ────────────────────────────────────────────────────────────────
  /** Fuel level — % (0-100) */
  FUEL_LEVEL:        'DiagnosticFuelLevelId',
  /** Fuel used — litres */
  FUEL_USED:         'DiagnosticFuelUsedId',
  /** Fuel rate — L/h */
  FUEL_RATE:         'DiagnosticEngineFuelRateId',

  // ── Electric vehicle ─────────────────────────────────────────────────────
  /** State of charge (EV) — % */
  EV_STATE_OF_CHARGE: 'DiagnosticStateOfChargeId',
  /** Battery temperature (EV) — °C */
  EV_BATTERY_TEMP:   'DiagnosticBatteryTemperatureId',

  // ── Driver behaviour ─────────────────────────────────────────────────────
  /** Harsh braking event — binary */
  HARSH_BRAKING:     'DiagnosticHarshBrakingId',
  /** Harsh acceleration event — binary */
  HARSH_ACCEL:       'DiagnosticHarshAccelerationId',
  /** Seat belt state — binary (0 = fastened, 1 = unfastened) */
  SEAT_BELT:         'DiagnosticSeatBeltId',

  // ── Vehicle power ────────────────────────────────────────────────────────
  /** Battery voltage — volts */
  BATTERY_VOLTAGE:   'DiagnosticVehicleBatteryVoltageId',
  /** Ignition state — binary */
  IGNITION:          'DiagnosticIgnitionId',
};

/**
 * Human-readable labels keyed by Diagnostic ID.
 * Useful for display / logging without hardcoding strings.
 */
const DiagnosticLabels = Object.fromEntries(
  Object.entries(Diagnostics).map(([label, id]) => [id, label.replace(/_/g, ' ').toLowerCase()])
);

/**
 * Shorthand groups for common use-cases.
 * Pass into LiveTracker.withDiagnostics() or HistoryQuery include options.
 */
const DiagnosticGroups = {
  /** Essential diagnostics for fleet dashboards */
  FLEET_BASICS:   [Diagnostics.ODOMETER, Diagnostics.FUEL_LEVEL, Diagnostics.ENGINE_HOURS],
  /** All four aux inputs */
  AUX_INPUTS:     [Diagnostics.AUX_INPUT_1, Diagnostics.AUX_INPUT_2, Diagnostics.AUX_INPUT_3, Diagnostics.AUX_INPUT_4],
  /** Engine health monitoring */
  ENGINE_HEALTH:  [Diagnostics.ENGINE_RPM, Diagnostics.COOLANT_TEMP, Diagnostics.OIL_TEMP, Diagnostics.OIL_PRESSURE],
  /** Driver behaviour signals */
  DRIVER_SAFETY:  [Diagnostics.HARSH_BRAKING, Diagnostics.HARSH_ACCEL, Diagnostics.SEAT_BELT],
  /** Electric vehicle telemetry */
  EV:             [Diagnostics.EV_STATE_OF_CHARGE, Diagnostics.EV_BATTERY_TEMP],
};

module.exports = { Diagnostics, DiagnosticLabels, DiagnosticGroups };

const COMPARISON = [
  { feature: 'Authentication & session',     raw: 'Manual re-auth on InvalidUserException',        sdk: 'Transparent — handled per call' },
  { feature: 'Rate limit handling',          raw: 'Catch OverLimitException, parse Retry-After',   sdk: 'Caught, Retry-After honored, retried once' },
  { feature: 'Live tracking pattern',        raw: 'DSI + StatusData + FaultData + manual merge',   sdk: 'sdk.liveTracker() fluent builder' },
  { feature: 'Bearing for live vehicles',    raw: "Remember it's only in DeviceStatusInfo",        sdk: 'Always present in v.location.bearing' },
  { feature: 'GPS pagination at 50k',        raw: 'Manual fromDate paging loop',                   sdk: 'Automatic inside sdk.history()' },
  { feature: 'Historical bearing',           raw: 'Compute atan2 from consecutive points',         sdk: 'computeBearing: true' },
  { feature: 'High-fidelity live tracking',  raw: 'LogRecord stream + StatusData merge + bearing calc + driver lookup', sdk: 'sdk.realtimeTracker() — derives all of it' },
  { feature: 'isDriving derivation',         raw: 'Use DSI.isDriving (lag) OR compute from ignition+speed', sdk: 'realtimeTracker: ignition + speed threshold' },
  { feature: 'GetFeed token persistence',    raw: 'You implement save-before-process',             sdk: "'version' event fires before 'data'" },
  { feature: 'GetFeed adaptive polling',     raw: 'Roll your own backoff',                         sdk: 'Built-in' },
  { feature: 'Diagnostic ID strings',        raw: "Memorize 'DiagnosticGoInputStatusId' etc.",     sdk: 'Diagnostics.AUX_INPUT_1 / .FUEL_LEVEL / ...' },
  { feature: 'Device name resolution',       raw: "Manual Get('Device') + your own cache",         sdk: 'EntityCache (1h TTL) used by helpers' },
  { feature: 'Group filtering',              raw: 'Pass groups to every search shape manually',    sdk: 'forGroups() on trackers · groupIds on snapshot · historyByGroups()' },
  { feature: 'Raw API access',               raw: 'Direct',                                        sdk: 'Yes — sdk.call() / sdk.multiCall()' },
];

export default function Compare({ onNavigate }) {
  return (
    <div className="page-compare">
      <p className="page-lede">
        The SDK collapses common boilerplate while keeping <code>sdk.call()</code> and{' '}
        <code>sdk.multiCall()</code> as escape hatches for anything not yet wrapped.
      </p>

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="col-feature">Feature</th>
              <th className="col-raw">Raw mg-api-js</th>
              <th className="col-sdk">geotab-smart-sdk</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row, i) => (
              <tr key={i}>
                <td className="cell-feature">{row.feature}</td>
                <td className="cell-raw">{row.raw}</td>
                <td className="cell-sdk">{row.sdk}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="compare-cta">
        <button className="btn btn-primary" onClick={() => onNavigate('playground')}>
          <i className="ti ti-flask" aria-hidden="true" />
          Try it in the Playground
        </button>
        <button className="btn btn-ghost" onClick={() => onNavigate('smart-sdk')}>
          <i className="ti ti-code" aria-hidden="true" />
          See the side-by-side code
        </button>
      </div>
    </div>
  );
}

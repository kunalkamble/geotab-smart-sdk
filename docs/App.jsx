import { useState } from "react";
import GeotabApiInspector from "./geotab-api-inspector.jsx";
import GeotabSmartSdkInspector from "./geotab-smart-sdk-inspector.jsx";

const COMPARISON = [
  { feature: "Authentication & session",     raw: "Manual re-auth on InvalidUserException",        sdk: "Transparent — handled per call" },
  { feature: "Rate limit handling",          raw: "Catch OverLimitException, parse Retry-After",   sdk: "Caught, Retry-After honored, retried once" },
  { feature: "Live tracking pattern",        raw: "DSI + StatusData + FaultData + manual merge",   sdk: "sdk.liveTracker() fluent builder" },
  { feature: "Bearing for live vehicles",    raw: "Remember it's only in DeviceStatusInfo",        sdk: "Always present in v.location.bearing" },
  { feature: "GPS pagination at 50k",        raw: "Manual fromDate paging loop",                   sdk: "Automatic inside sdk.history()" },
  { feature: "Historical bearing",           raw: "Compute atan2 from consecutive points",         sdk: "computeBearing: true" },
  { feature: "GetFeed token persistence",    raw: "You implement save-before-process",             sdk: "'version' event fires before 'data'" },
  { feature: "GetFeed adaptive polling",     raw: "Roll your own backoff",                         sdk: "Built-in" },
  { feature: "Diagnostic ID strings",        raw: "Memorize 'DiagnosticGoInputStatusId' etc.",     sdk: "Diagnostics.AUX_INPUT_1 / .FUEL_LEVEL / ..." },
  { feature: "Device name resolution",       raw: "Manual Get('Device') + your own cache",         sdk: "EntityCache (1h TTL) used by helpers" },
  { feature: "Raw API access",               raw: "Direct",                                        sdk: "Yes — sdk.call() / sdk.multiCall()" },
];

const OPTIONS = [
  {
    id: "sdk",
    title: "geotab-smart-sdk",
    subtitle: "this package · recommended",
    icon: "ti-sparkles",
    accent: "var(--accent-green-fg)",
    accentSolid: "#0F6E56",
    description:
      "Use-case-driven helpers built on top of mg-api-js. Adaptive feeds, named diagnostic constants, automatic session and rate-limit handling, and an entity cache — the same MyGeotab data with far less code.",
    bullets: [
      "liveTracker / history / fleetSnapshot / feeds",
      "Diagnostics.* named constants + groups",
      "Auto re-auth & Retry-After backoff",
      "Crash-safe GetFeed token rotation",
    ],
    cta: "Open SDK inspector",
    Component: GeotabSmartSdkInspector,
  },
  {
    id: "raw",
    title: "Raw MyGeotab API",
    subtitle: "via mg-api-js",
    icon: "ti-terminal-2",
    accent: "var(--accent-blue-fg)",
    accentSolid: "#185FA5",
    description:
      "Low-level reference for developers using the official Geotab JS SDK directly. Field maps, multiCall patterns, rate limits, and gotchas — everything you need to fetch data the unwrapped way.",
    bullets: [
      "Use-case guide per entity type",
      "Field availability matrix",
      "multiCall recipes",
      "Rate-limit reference",
    ],
    cta: "Open raw-API inspector",
    Component: GeotabApiInspector,
  },
];

export default function App() {
  const [viewId, setViewId] = useState("home");

  if (viewId !== "home") {
    const opt = OPTIONS.find(o => o.id === viewId);
    const Inspector = opt.Component;
    return (
      <div>
        <BackBar opt={opt} onBack={() => setViewId("home")} />
        <Inspector />
      </div>
    );
  }

  return <Home onChoose={setViewId} />;
}

function BackBar({ opt, onBack }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      paddingBottom: 16, marginBottom: 20,
      borderBottom: "0.5px solid var(--color-border-tertiary)",
    }}>
      <button
        onClick={onBack}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", color: "var(--color-text-secondary)",
          border: "0.5px solid var(--color-border-secondary)",
          padding: "6px 12px", borderRadius: 6, cursor: "pointer",
          fontSize: 13, fontFamily: "var(--font-sans)",
        }}
      >
        <i className="ti ti-arrow-left" aria-hidden="true" />
        Overview
      </button>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
        Viewing:{" "}
        <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          {opt.title}
        </span>
      </div>
    </div>
  );
}

function Home({ onChoose }) {
  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{
          fontSize: 32, fontWeight: 500, color: "var(--color-text-primary)",
          margin: "0 0 10px 0", letterSpacing: "-0.01em",
        }}>
          Geotab API Inspector
        </h1>
        <p style={{
          fontSize: 15, color: "var(--color-text-secondary)",
          margin: 0, lineHeight: 1.6, maxWidth: 720,
        }}>
          Two reference inspectors for working with the MyGeotab API. Pick the one that matches how you build.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 18,
      }}>
        {OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => onChoose(opt.id)}
            aria-label={opt.cta}
            style={{
              textAlign: "left", cursor: "pointer",
              background: "var(--color-background-primary)",
              border: "0.5px solid var(--color-border-tertiary)",
              borderRadius: 12, padding: 22,
              fontFamily: "var(--font-sans)",
              display: "flex", flexDirection: "column", gap: 14,
              transition: "border-color 0.15s, transform 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = opt.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--color-border-tertiary)"}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: opt.accentSolid, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className={`ti ${opt.icon}`} style={{ fontSize: 22 }} aria-hidden="true" />
            </div>

            <div>
              <div style={{
                fontSize: 18, fontWeight: 500,
                color: "var(--color-text-primary)", marginBottom: 4,
              }}>
                {opt.title}
              </div>
              <div style={{
                fontSize: 11.5, color: "var(--color-text-tertiary)",
                fontFamily: "var(--font-mono)", marginBottom: 12,
                textTransform: "uppercase", letterSpacing: "0.04em",
              }}>
                {opt.subtitle}
              </div>
              <div style={{
                fontSize: 13.5, color: "var(--color-text-secondary)",
                lineHeight: 1.6, marginBottom: 14,
              }}>
                {opt.description}
              </div>
              <ul style={{
                margin: 0, padding: 0, listStyle: "none",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                {opt.bullets.map((b, i) => (
                  <li key={i} style={{
                    fontSize: 13, color: "var(--color-text-secondary)",
                    display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5,
                  }}>
                    <i
                      className="ti ti-check"
                      style={{ color: opt.accent, fontSize: 14, marginTop: 2, flexShrink: 0 }}
                      aria-hidden="true"
                    />
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{
              marginTop: "auto", display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, color: opt.accent, fontWeight: 500,
            }}>
              {opt.cta}
              <i className="ti ti-arrow-right" aria-hidden="true" />
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 40 }}>
        <h2 style={{
          fontSize: 20, fontWeight: 500, color: "var(--color-text-primary)",
          margin: "0 0 6px 0", letterSpacing: "-0.01em",
        }}>
          How they compare
        </h2>
        <p style={{
          fontSize: 13.5, color: "var(--color-text-secondary)",
          margin: "0 0 16px 0", lineHeight: 1.6,
        }}>
          Same MyGeotab data underneath — different amount of code you write.
        </p>
        <div style={{
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: 10, overflow: "hidden",
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 500,
                    color: "var(--color-text-secondary)",
                    background: "var(--color-background-secondary)",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    width: "26%",
                  }}>Feature</th>
                  <th style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 500,
                    color: "var(--accent-blue-fg)",
                    background: "var(--color-background-secondary)",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    fontFamily: "var(--font-mono)",
                  }}>Raw mg-api-js</th>
                  <th style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 500,
                    color: "var(--accent-green-fg)",
                    background: "var(--color-background-secondary)",
                    borderBottom: "0.5px solid var(--color-border-tertiary)",
                    fontFamily: "var(--font-mono)",
                  }}>geotab-smart-sdk</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={i} style={{
                    borderBottom: i < COMPARISON.length - 1
                      ? "0.5px solid var(--color-border-tertiary)"
                      : "none",
                  }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500 }}>
                      {row.feature}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                      {row.raw}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                      {row.sdk}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 24, padding: "14px 16px",
        background: "var(--color-background-secondary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 10, display: "flex", gap: 10, alignItems: "flex-start",
      }}>
        <i
          className="ti ti-info-circle"
          style={{ color: "var(--accent-blue-fg)", fontSize: 16, marginTop: 1, flexShrink: 0 }}
          aria-hidden="true"
        />
        <div style={{
          fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6,
        }}>
          New to MyGeotab? Start with the <strong style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          geotab-smart-sdk</strong> inspector — it shows the common use cases with the least friction.
          The raw inspector is useful when you're already on <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>mg-api-js</code> or
          need an entity not yet covered by SDK helpers.
        </div>
      </div>
    </div>
  );
}

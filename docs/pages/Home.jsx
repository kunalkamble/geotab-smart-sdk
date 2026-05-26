const FEATURE_CARDS = [
  {
    id: 'smart-sdk',
    title: 'Smart SDK Inspector',
    subtitle: 'use cases · helper map · cheat sheet',
    icon: 'ti-sparkles',
    accent: 'var(--accent-green-fg)',
    accentSolid: '#0F6E56',
    description:
      'How to use this package — five real-world recipes (live tracking, realtime, history, fleet snapshot, GetFeed), a matrix of which helper produces what, side-by-side comparisons with raw mg-api-js, and a one-page cheat sheet.',
    cta: 'Open Smart SDK',
  },
  {
    id: 'raw-api',
    title: 'Raw MyGeotab API',
    subtitle: 'via mg-api-js · entity-level reference',
    icon: 'ti-terminal-2',
    accent: 'var(--accent-blue-fg)',
    accentSolid: '#185FA5',
    description:
      'Low-level reference for developers using the official Geotab JS SDK directly. Field map per entity, multiCall recipes, rate limits, and the gotchas that bite you first.',
    cta: 'Open Raw API',
  },
  {
    id: 'playground',
    title: 'Playground',
    subtitle: 'live · interactive · uses your MyGeotab credentials',
    icon: 'ti-flask',
    accent: 'var(--accent-amber-fg)',
    accentSolid: '#854F0B',
    description:
      'Plug in your credentials and exercise the SDK against your fleet — live tracker, realtime tracker, historical query, fleet snapshot. View results as a table or on an interactive map.',
    cta: 'Open Playground',
  },
];

const HIGHLIGHTS = [
  { icon: 'ti-bolt',       text: 'Use-case-driven helpers built on mg-api-js' },
  { icon: 'ti-shield',     text: 'Auto re-auth & Retry-After rate-limit handling' },
  { icon: 'ti-tag',        text: 'Named Diagnostic constants — no opaque strings' },
  { icon: 'ti-arrows-double-ne-sw', text: 'Crash-safe GetFeed token rotation' },
  { icon: 'ti-target',     text: 'Group filtering across every helper' },
  { icon: 'ti-map-pin',    text: 'Two trackers: DSI snapshot or LogRecord high-fidelity' },
];

export default function Home({ onNavigate }) {
  return (
    <div className="page-home">
      <section className="hero">
        <h1 className="hero-title">geotab-smart-sdk</h1>
        <p className="hero-tagline">
          A smart, composable Node.js SDK for the MyGeotab API — built on top of{' '}
          <code>mg-api-js</code>. Adaptive feeds, named diagnostics, two complementary
          trackers, and an entity cache, all behind helpers that answer the questions
          that slow developers down first.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => onNavigate('playground')}>
            <i className="ti ti-flask" aria-hidden="true" />
            Try the Playground
          </button>
          <button className="btn btn-ghost" onClick={() => onNavigate('smart-sdk')}>
            <i className="ti ti-book-2" aria-hidden="true" />
            Read the docs
          </button>
        </div>
      </section>

      <section className="highlights">
        {HIGHLIGHTS.map((h, i) => (
          <div key={i} className="highlight">
            <i className={`ti ${h.icon}`} aria-hidden="true" />
            <span>{h.text}</span>
          </div>
        ))}
      </section>

      <section className="card-grid">
        {FEATURE_CARDS.map((card) => (
          <button
            key={card.id}
            className="feature-card"
            onClick={() => onNavigate(card.id)}
            style={{ '--card-accent': card.accent, '--card-accent-solid': card.accentSolid }}
          >
            <div className="feature-card-icon">
              <i className={`ti ${card.icon}`} aria-hidden="true" />
            </div>
            <div className="feature-card-title">{card.title}</div>
            <div className="feature-card-subtitle">{card.subtitle}</div>
            <div className="feature-card-body">{card.description}</div>
            <div className="feature-card-cta">
              {card.cta} <i className="ti ti-arrow-right" aria-hidden="true" />
            </div>
          </button>
        ))}
      </section>

      <section className="footer-callout">
        <i className="ti ti-info-circle" aria-hidden="true" />
        <div>
          New to MyGeotab?{' '}
          <button className="link-button" onClick={() => onNavigate('smart-sdk')}>
            Start with the Smart SDK inspector
          </button>
          {' '}— it shows the common use cases with the least friction. The Raw API view
          is useful when you're already using <code>mg-api-js</code> or need an entity
          not yet covered by SDK helpers.
        </div>
      </section>
    </div>
  );
}

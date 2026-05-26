/**
 * Sponsor page — a quiet, honest pitch for supporting maintenance time.
 * No tier ladders, no goal bars; just what the project is, who maintains
 * it, and where to go if you'd like to help.
 */

const SPONSOR_URL = 'https://github.com/sponsors/kunalkamble';

const WAYS_TO_HELP = [
  {
    icon: 'ti-heart',
    title: 'Sponsor on GitHub',
    description: 'One-time or recurring — both options are on the GitHub Sponsors page. Even a few dollars a month meaningfully signals that the project is worth maintaining.',
    href: SPONSOR_URL,
    primary: true,
  },
  {
    icon: 'ti-star',
    title: 'Star the repo',
    description: 'Free, takes a second. Helps the project surface in search and gives a clearer signal of usage to the maintainer.',
    href: 'https://github.com/kunalkamble/geotab-smart-sdk',
  },
  {
    icon: 'ti-bug',
    title: 'Report bugs & ideas',
    description: 'File an issue with a clear repro or a feature use-case. Good bug reports are worth a lot — they save maintenance hours that turn into feature work.',
    href: 'https://github.com/kunalkamble/geotab-smart-sdk/issues',
  },
  {
    icon: 'ti-git-pull-request',
    title: 'Send a pull request',
    description: 'Patches welcome. The SDK is small, well-tested (87 tests, 84% coverage), and the codebase is intentionally simple — easy to contribute to.',
    href: 'https://github.com/kunalkamble/geotab-smart-sdk/pulls',
  },
];

export default function Sponsor({ onNavigate }) {
  return (
    <div className="page-sponsor">
      <section className="sponsor-hero">
        <div className="sponsor-hero-icon"><i className="ti ti-heart-handshake" aria-hidden="true" /></div>
        <h1 className="sponsor-hero-title">Support geotab-smart-sdk</h1>
        <p className="sponsor-hero-tagline">
          <strong>geotab-smart-sdk</strong> is open source, MIT licensed, and maintained
          on personal time by{' '}
          <a href="https://github.com/kunalkamble" target="_blank" rel="noreferrer">
            @kunalkamble
          </a>. If it's saved you hours wrestling with the raw MyGeotab API,
          consider sponsoring — it keeps features and fixes flowing.
        </p>
        <div className="sponsor-hero-actions">
          <a className="btn btn-primary" href={SPONSOR_URL} target="_blank" rel="noreferrer">
            <i className="ti ti-heart" aria-hidden="true" />
            Sponsor on GitHub
          </a>
          <button className="btn btn-ghost" onClick={() => onNavigate('guide')}>
            <i className="ti ti-book-2" aria-hidden="true" />
            Read the Guide
          </button>
        </div>
      </section>

      <section className="sponsor-impact">
        <h2>Why it matters</h2>
        <ul className="sponsor-impact-list">
          <li>
            <i className="ti ti-bolt" aria-hidden="true" />
            <div>
              <strong>Faster issue turnaround.</strong> Sponsored time means bug reports
              and PR reviews land in days, not weeks.
            </div>
          </li>
          <li>
            <i className="ti ti-tools" aria-hidden="true" />
            <div>
              <strong>Maintenance you can rely on.</strong> Geotab API changes, new
              entity types, deprecations — the SDK keeps up.
            </div>
          </li>
          <li>
            <i className="ti ti-sparkles" aria-hidden="true" />
            <div>
              <strong>Bigger features.</strong> A funded project can ship things like
              first-class TypeScript types, a CLI, or a hosted Playground proxy
              for the Ask-Claude tab.
            </div>
          </li>
          <li>
            <i className="ti ti-shield-check" aria-hidden="true" />
            <div>
              <strong>Security & coverage.</strong> Time to invest in the test
              coverage gap (Sessions auth flow, tracker poll loops) and proactive
              dep audits.
            </div>
          </li>
        </ul>
      </section>

      <section className="sponsor-ways">
        <h2>Ways to help</h2>
        <div className="sponsor-ways-grid">
          {WAYS_TO_HELP.map((w) => (
            <a
              key={w.title}
              className={`sponsor-way ${w.primary ? 'primary' : ''}`}
              href={w.href}
              target="_blank"
              rel="noreferrer"
            >
              <div className="sponsor-way-icon">
                <i className={`ti ${w.icon}`} aria-hidden="true" />
              </div>
              <div className="sponsor-way-title">{w.title}</div>
              <div className="sponsor-way-desc">{w.description}</div>
              <div className="sponsor-way-cta">
                Open <i className="ti ti-external-link" aria-hidden="true" />
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="sponsor-thanks">
        <i className="ti ti-info-circle" aria-hidden="true" />
        <div>
          <strong>Not in a position to sponsor?</strong> That's completely fine.
          A GitHub star or a thoughtful issue report is honestly just as
          valuable for an early-stage project like this.
        </div>
      </section>
    </div>
  );
}

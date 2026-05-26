import { useState, useEffect } from 'react';
import Home from './pages/Home.jsx';
import Guide from './pages/Guide.jsx';
import Compare from './pages/Compare.jsx';
import Playground from './pages/Playground.jsx';
import Sponsor from './pages/Sponsor.jsx';
import GeotabSmartSdkInspector from './geotab-smart-sdk-inspector.jsx';
import GeotabApiInspector from './geotab-api-inspector.jsx';
import pkg from '../package.json';

const ROUTES = [
  {
    id: 'home', label: 'Home', icon: 'ti-home',
    title: 'geotab-smart-sdk',
    description: 'Smart, composable Node.js SDK for the MyGeotab API',
    Component: Home,
  },
  {
    id: 'guide', label: 'Guide', icon: 'ti-book-2',
    title: 'Guide',
    description: 'Prose reference: setup, sessions, group filtering, errors, GetFeed rules',
    Component: Guide,
  },
  {
    id: 'compare', label: 'Compare', icon: 'ti-arrows-right-left',
    title: 'Smart SDK vs Raw MyGeotab API',
    description: 'Same data underneath — different amount of code you write',
    Component: Compare,
  },
  {
    id: 'smart-sdk', label: 'Smart SDK', icon: 'ti-sparkles',
    title: 'Smart SDK Inspector',
    description: 'Use cases · helper map · vs raw API · diagnostics · cheat sheet',
    Component: GeotabSmartSdkInspector,
  },
  {
    id: 'raw-api', label: 'Raw API', icon: 'ti-terminal-2',
    title: 'Raw MyGeotab API Inspector',
    description: 'Entity-level reference for developers using mg-api-js directly',
    Component: GeotabApiInspector,
  },
  {
    id: 'playground', label: 'Playground', icon: 'ti-flask',
    title: 'Playground',
    description: 'Exercise the SDK against your fleet — table or interactive map',
    Component: Playground,
  },
  {
    id: 'sponsor', label: 'Sponsor', icon: 'ti-heart',
    title: 'Support geotab-smart-sdk',
    description: 'Open source, MIT licensed — sponsorship keeps fixes and features flowing',
    Component: Sponsor,
  },
];

const DEFAULT_ROUTE = 'home';

// Route hashes look like `#/playground`. In-page anchors like `#install`
// (used by Guide's TOC) are NOT routes — they should leave the current
// route alone and just let the browser scroll. Returning `null` from
// parseRoute means "don't change route."
function parseRoute() {
  const hash = window.location.hash;
  if (!hash.startsWith('#/')) return null;
  const id = hash.slice(2);
  return ROUTES.find(r => r.id === id) ? id : DEFAULT_ROUTE;
}

function useHashRoute() {
  const [route, setRoute] = useState(() => parseRoute() ?? DEFAULT_ROUTE);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseRoute();
      if (next !== null) setRoute(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (id) => { window.location.hash = `#/${id}`; };
  return [route, navigate];
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(`(max-width: ${breakpoint}px)`).matches);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const active = ROUTES.find(r => r.id === route) ?? ROUTES[0];
  const ActiveComponent = active.Component;

  function go(id) {
    navigate(id);
    setDrawerOpen(false);
  }

  return (
    <div className="app-shell">
      {/* Top bar — shows the active route's title + description */}
      <header className="app-topbar">
        {isMobile && (
          <button
            className="app-hamburger"
            aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setDrawerOpen(o => !o)}
          >
            <i className={`ti ${drawerOpen ? 'ti-x' : 'ti-menu-2'}`} aria-hidden="true" />
          </button>
        )}
        <button
          className="app-home-button"
          onClick={() => go('home')}
          aria-label="Home"
          title="Home"
        >
          <i className="ti ti-truck" aria-hidden="true" />
        </button>
        <div className="app-topbar-page">
          <div className="app-topbar-title">{active.title}</div>
          <div className="app-topbar-description">{active.description}</div>
        </div>
        <button
          className="app-topbar-link app-topbar-sponsor"
          onClick={() => go('sponsor')}
          aria-label="Support this project"
          title="Support this project"
        >
          <i className="ti ti-heart" aria-hidden="true" />
          <span className="app-topbar-link-text">Sponsor</span>
        </button>
        <a
          className="app-topbar-link"
          href="https://github.com/kunalkamble/geotab-smart-sdk"
          target="_blank"
          rel="noreferrer"
        >
          <i className="ti ti-brand-github" aria-hidden="true" />
          <span className="app-topbar-link-text">GitHub</span>
        </a>
      </header>

      <div className="app-body">
        {/* Sidebar (desktop) or drawer (mobile) */}
        {isMobile && drawerOpen && (
          <div className="app-backdrop" onClick={() => setDrawerOpen(false)} />
        )}
        <nav className={`app-sidebar ${isMobile ? 'mobile' : ''} ${drawerOpen ? 'open' : ''}`}>
          <ul>
            {ROUTES.map(r => (
              <li key={r.id}>
                <button
                  className={`app-nav-item ${route === r.id ? 'active' : ''}`}
                  onClick={() => go(r.id)}
                >
                  <i className={`ti ${r.icon}`} aria-hidden="true" />
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="app-sidebar-foot">
            <div className="app-sidebar-foot-title">geotab-smart-sdk</div>
            <div className="app-sidebar-foot-sub">v{pkg.version} · MIT</div>
          </div>
        </nav>

        {/* Page */}
        <main className="app-main" key={route}>
          <ActiveComponent onNavigate={go} />
        </main>
      </div>
    </div>
  );
}

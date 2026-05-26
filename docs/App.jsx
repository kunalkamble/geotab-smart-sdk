import { useState, useEffect } from 'react';
import Home from './pages/Home.jsx';
import Compare from './pages/Compare.jsx';
import Playground from './pages/Playground.jsx';
import GeotabSmartSdkInspector from './geotab-smart-sdk-inspector.jsx';
import GeotabApiInspector from './geotab-api-inspector.jsx';

const ROUTES = [
  {
    id: 'home', label: 'Home', icon: 'ti-home',
    title: 'geotab-smart-sdk',
    description: 'Smart, composable Node.js SDK for the MyGeotab API',
    Component: Home,
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
];

const DEFAULT_ROUTE = 'home';

function useHashRoute() {
  const [route, setRoute] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '');
    return ROUTES.find(r => r.id === h) ? h : DEFAULT_ROUTE;
  });

  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.replace(/^#\/?/, '');
      setRoute(ROUTES.find(r => r.id === h) ? h : DEFAULT_ROUTE);
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
            <div className="app-sidebar-foot-sub">v0.1.0 · MIT</div>
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

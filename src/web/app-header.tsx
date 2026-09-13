import { useEffect, useState } from 'react';

export function AppHeader() {
  const [actualConnected, setActualConnected] = useState<boolean>();

  useEffect(() => {
    void fetch('/api/actual/status')
      .then((response) => setActualConnected(response.ok))
      .catch(() => setActualConnected(false));
  }, []);

  return <header className="app-header">
    <div className="app-branding">
      <a className="app-title" href="/">AB Importer</a>
      {actualConnected !== undefined && <p role="status" className={actualConnected ? 'connection-status connection-status-ok' : 'connection-status connection-status-error'}>{actualConnected ? '● Connected to Actual Budget' : '● Actual Budget connection unavailable'}</p>}
    </div>
    <nav className="app-navigation" aria-label="Primary navigation">
      <a className="button-link" href="?rules">Rules</a>
      <a className="button-link" href="?categories">Categories</a>
    </nav>
  </header>;
}

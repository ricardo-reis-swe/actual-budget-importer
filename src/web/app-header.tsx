import { useEffect, useState } from 'react';

export type HeaderModal = 'categories' | 'parserSettings' | 'rules';

export function AppHeader({ onOpenModal }: { onOpenModal: (modal: HeaderModal) => void }) {
  const [actualConnected, setActualConnected] = useState<boolean>();

  useEffect(() => {
    void fetch('/api/actual/status')
      .then((response) => setActualConnected(response.ok))
      .catch(() => setActualConnected(false));
  }, []);

  return <header className="app-header">
    <div className="app-brand-group">
      <a className="app-logo-link" href="/" aria-label="Actual Budget Importer home">
        <img className="app-logo" src="/actual-budget-importer-icon.svg" alt="" />
      </a>
      <div className="app-branding">
        <a className="app-title" href="/">Actual Budget Importer</a>
        {actualConnected === undefined
          ? <p className="connection-status connection-status-loading" aria-label="Checking Actual Budget connection"><span className="connection-status-skeleton" aria-hidden="true" /></p>
          : <p role="status" className={actualConnected ? 'connection-status connection-status-ok' : 'connection-status connection-status-error'}>{actualConnected ? '● Connected to Actual Budget' : '● Actual Budget connection unavailable'}</p>}
      </div>
    </div>
    <nav className="app-navigation" aria-label="Primary navigation">
      <button type="button" className="button-link" onClick={() => onOpenModal('parserSettings')}>Parser settings</button>
      <button type="button" className="button-link" onClick={() => onOpenModal('rules')}>Rules</button>
      <button type="button" className="button-link" onClick={() => onOpenModal('categories')}>Categories</button>
    </nav>
  </header>;
}

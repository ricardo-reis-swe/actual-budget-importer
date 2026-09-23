import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';

import { StatementDashboard } from './statement-dashboard.js';
import { CategorizationRulesPage } from './categorization-rules-page.js';
import { CategoriesPage } from './categories-page.js';
import { StatementReviewPage } from './statement-review-page.js';
import { AppHeader } from './app-header.js';
import type { HeaderModal } from './app-header.js';
import { ParserSettingsPage } from './parser-settings-page.js';
import './styles.css';

function HeaderModalDialog({ modal, onClose, onDataChanged, parserSetupRequired, onParserSetupComplete }: {
  modal: HeaderModal;
  onClose: () => void;
  onDataChanged: () => void;
  parserSetupRequired: boolean;
  onParserSetupComplete(): void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !parserSetupRequired) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, parserSetupRequired]);

  const content = modal === 'parserSettings'
    ? <ParserSettingsPage initialSetup={parserSetupRequired} onDataChanged={onDataChanged} onSetupComplete={onParserSetupComplete} />
    : modal === 'rules' ? <CategorizationRulesPage onRulesChanged={onDataChanged} /> : <CategoriesPage onDataChanged={onDataChanged} />;

  return <div className="header-modal-backdrop" onMouseDown={(event) => { if (!parserSetupRequired && event.target === event.currentTarget) onClose(); }}>
    <section className="header-modal" role="dialog" aria-modal="true" aria-label={modal === 'parserSettings' ? 'Parser settings' : modal === 'rules' ? 'Transaction rules' : 'Categories'}>
      {!parserSetupRequired && <button autoFocus type="button" className="header-modal-close secondary-button" onClick={onClose} aria-label="Close dialog">×</button>}
      {content}
    </section>
  </div>;
}

function App() {
  const [modal, setModal] = useState<HeaderModal>();
  const [parserSetupRequired, setParserSetupRequired] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const statementId = new URLSearchParams(window.location.search).get('statementId');

  useEffect(() => {
    if (!statementId) void fetch('/api/categories/refresh', { method: 'POST' }).catch(() => undefined);
  }, [statementId]);

  useEffect(() => {
    void fetch('/api/parser-settings')
      .then((response) => response.ok ? response.json() as Promise<{ setupComplete: boolean }> : undefined)
      .then((settings) => {
        if (settings && !settings.setupComplete) {
          setParserSetupRequired(true);
          setModal('parserSettings');
        }
      })
      .catch(() => undefined);
  }, []);

  return <><AppHeader onOpenModal={setModal} />{statementId ? <StatementReviewPage dataRevision={dataRevision} /> : <StatementDashboard dataRevision={dataRevision} />}{modal && <HeaderModalDialog modal={modal} onClose={() => setModal(undefined)} onDataChanged={() => setDataRevision((current) => current + 1)} parserSetupRequired={parserSetupRequired && modal === 'parserSettings'} onParserSetupComplete={() => { setParserSetupRequired(false); setModal(undefined); }} />}</>;
}

createRoot(document.getElementById('root')!).render(<App />);

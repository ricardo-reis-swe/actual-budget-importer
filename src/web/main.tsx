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

function HeaderModalDialog({ modal, onClose }: { modal: HeaderModal; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const content = modal === 'parserSettings'
    ? <ParserSettingsPage />
    : modal === 'rules' ? <CategorizationRulesPage /> : <CategoriesPage />;

  return <div className="header-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="header-modal" role="dialog" aria-modal="true" aria-label={modal === 'parserSettings' ? 'Parser settings' : modal === 'rules' ? 'Transaction rules' : 'Categories'}>
      <button autoFocus type="button" className="header-modal-close secondary-button" onClick={onClose} aria-label="Close dialog">×</button>
      {content}
    </section>
  </div>;
}

function App() {
  const [modal, setModal] = useState<HeaderModal>();
  const statementId = new URLSearchParams(window.location.search).get('statementId');

  useEffect(() => {
    if (!statementId) void fetch('/api/categories/refresh', { method: 'POST' }).catch(() => undefined);
  }, [statementId]);

  return <><AppHeader onOpenModal={setModal} />{statementId ? <StatementReviewPage /> : <StatementDashboard />}{modal && <HeaderModalDialog modal={modal} onClose={() => setModal(undefined)} />}</>;
}

createRoot(document.getElementById('root')!).render(<App />);

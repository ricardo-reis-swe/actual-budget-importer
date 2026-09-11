import { createRoot } from 'react-dom/client';

import { StatementDashboard } from './statement-dashboard.js';
import { CategorizationRulesPage } from './categorization-rules-page.js';
import { StatementReviewPage } from './statement-review-page.js';
import './styles.css';

const statementId = new URLSearchParams(window.location.search).get('statementId');
const rules = new URLSearchParams(window.location.search).get('rules');

createRoot(document.getElementById('root')!).render(statementId ? <StatementReviewPage /> : rules !== null ? <CategorizationRulesPage /> : <StatementDashboard />);

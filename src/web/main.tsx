import { createRoot } from 'react-dom/client';

import { StatementDashboard } from './statement-dashboard.js';
import { StatementReviewPage } from './statement-review-page.js';

const statementId = new URLSearchParams(window.location.search).get('statementId');

createRoot(document.getElementById('root')!).render(statementId ? <StatementReviewPage /> : <StatementDashboard />);

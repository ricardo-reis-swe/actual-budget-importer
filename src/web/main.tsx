import { createRoot } from 'react-dom/client';

import { StatementDashboard } from './statement-dashboard.js';
import { CategorizationRulesPage } from './categorization-rules-page.js';
import { CategoriesPage } from './categories-page.js';
import { StatementReviewPage } from './statement-review-page.js';
import { AppHeader } from './app-header.js';
import './styles.css';

const statementId = new URLSearchParams(window.location.search).get('statementId');
const rules = new URLSearchParams(window.location.search).get('rules');
const categories = new URLSearchParams(window.location.search).get('categories');

const page = statementId ? <StatementReviewPage /> : rules !== null ? <CategorizationRulesPage /> : categories !== null ? <CategoriesPage /> : <StatementDashboard />;

createRoot(document.getElementById('root')!).render(<><AppHeader />{page}</>);

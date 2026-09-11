import { useEffect, useMemo, useState } from 'react';

import { messages } from './messages.js';

interface StatementSummary {
  dateRange: { end: string; start: string } | null;
  id: number;
  originalFilename: string | null;
  parserId: string | null;
  paperlessCorrespondentName: string | null;
  paperlessDocumentDate: string | null;
  paperlessDocumentTitle: string | null;
  status: string;
  transactionCount: number;
}

const attentionStatuses = new Set(['awaiting parser selection', 'extraction failed', 'publish failed']);

function sourceName(statement: StatementSummary): string {
  return statement.originalFilename ?? statement.paperlessDocumentTitle ?? messages.dashboard.unknownSource;
}

function dateRange(statement: StatementSummary): string | undefined {
  if (statement.dateRange) {
    return statement.dateRange.start === statement.dateRange.end
      ? statement.dateRange.start
      : `${statement.dateRange.start} – ${statement.dateRange.end}`;
  }
  return statement.paperlessDocumentDate ?? undefined;
}

function StatementList({ statements }: { statements: StatementSummary[] }) {
  return <ul>
    {statements.map((statement) => {
      const range = dateRange(statement);
      return <li key={statement.id}>
        <a href={`?statementId=${encodeURIComponent(statement.id)}`}>{sourceName(statement)}</a>
        <p>{statement.status}{statement.parserId ? ` · ${statement.parserId}` : ''}</p>
        <p>{messages.dashboard.transactionCount(statement.transactionCount)}{range ? ` · ${range}` : ''}</p>
        {statement.paperlessCorrespondentName && <p>Paperless-ngx: {statement.paperlessCorrespondentName}</p>}
      </li>;
    })}
  </ul>;
}

export function StatementDashboard() {
  const [statements, setStatements] = useState<StatementSummary[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch('/api/statements')
      .then(async (response) => {
        if (!response.ok) throw new Error(messages.dashboard.loadError);
        return response.json() as Promise<{ statements: StatementSummary[] }>;
      })
      .then((loaded) => setStatements(loaded.statements))
      .catch(() => setError(messages.dashboard.loadError));
  }, []);

  const grouped = useMemo(() => {
    const nonPublished = statements?.filter((statement) => statement.status !== 'published') ?? [];
    return {
      attention: nonPublished.filter((statement) => attentionStatuses.has(statement.status)),
      published: statements?.filter((statement) => statement.status === 'published') ?? [],
      review: nonPublished.filter((statement) => !attentionStatuses.has(statement.status)),
    };
  }, [statements]);

  if (error) return <main><p role="alert">{error}</p></main>;
  if (!statements) return <main><p>{messages.dashboard.loading}</p></main>;

  return <main>
    <h1>{messages.dashboard.title}</h1>
    <p>{messages.dashboard.needsAttention}: {grouped.attention.length}</p>
    {grouped.attention.length > 0 && <section aria-labelledby="attention-heading">
      <h2 id="attention-heading">{messages.dashboard.needsAttention}</h2>
      <StatementList statements={grouped.attention} />
    </section>}
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">{messages.dashboard.review} ({grouped.review.length})</h2>
      {grouped.review.length === 0 ? <p>{messages.dashboard.emptyReview}</p> : <StatementList statements={grouped.review} />}
    </section>
    <section aria-labelledby="published-heading">
      <h2 id="published-heading">{messages.dashboard.published}</h2>
      {grouped.published.length === 0 ? <p>{messages.dashboard.emptyPublished}</p> : <StatementList statements={grouped.published} />}
    </section>
  </main>;
}

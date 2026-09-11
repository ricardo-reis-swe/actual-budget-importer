import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

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

interface ParserOption {
  id: string;
  name: string;
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
  return <ul className="statement-list">
    {statements.map((statement) => {
      const range = dateRange(statement);
      return <li key={statement.id}>
        <a className="statement-card" href={`?statementId=${encodeURIComponent(statement.id)}`}>
          <span className="statement-card-heading">{sourceName(statement)}</span>
          <span className="statement-card-meta">{statement.status}{statement.parserId ? ` · ${statement.parserId}` : ''}</span>
          <span className="statement-card-meta">{messages.dashboard.transactionCount(statement.transactionCount)}{range ? ` · ${range}` : ''}</span>
          {statement.paperlessCorrespondentName && <span className="statement-card-meta">Paperless-ngx · {statement.paperlessCorrespondentName}</span>}
        </a>
      </li>;
    })}
  </ul>;
}

function UploadForm() {
  const [parsers, setParsers] = useState<ParserOption[]>();
  const [file, setFile] = useState<File>();
  const [parserId, setParserId] = useState('');
  const [error, setError] = useState<string>();
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    void fetch('/api/parsers')
      .then(async (response) => {
        if (!response.ok) throw new Error(messages.upload.error);
        return response.json() as Promise<{ parsers: ParserOption[] }>;
      })
      .then((loaded) => setParsers(loaded.parsers))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : messages.upload.error));
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError(messages.upload.fileRequired);
      return;
    }
    if (!parserId) {
      setError(messages.upload.parserRequired);
      return;
    }
    setError(undefined);
    setIsUploading(true);
    const form = new FormData();
    form.append('parserId', parserId);
    form.append('file', file);
    void fetch('/api/statements/upload', { method: 'POST', body: form })
      .then(async (response) => {
        const result = await response.json() as { message?: string; statementId?: number };
        if (!response.ok || !result.statementId) throw new Error(result.message ?? messages.upload.error);
        window.location.href = `?statementId=${encodeURIComponent(result.statementId)}`;
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : messages.upload.error);
        setIsUploading(false);
      });
  };

  return <section aria-labelledby="upload-heading">
    <h2 id="upload-heading">{messages.upload.title}</h2>
    <form onSubmit={submit}>
      <label>{messages.upload.chooseFile} <input type="file" accept="application/pdf,.pdf" onChange={(event) => {
        setFile(event.target.files?.[0]);
        setError(undefined);
      }} disabled={isUploading} /></label>
      <label>{messages.upload.chooseParser} <select value={parserId} onChange={(event) => { setParserId(event.target.value); setError(undefined); }} disabled={!parsers || isUploading} required>
        <option value="">{messages.upload.chooseParser}</option>
        {parsers?.map((parser) => <option key={parser.id} value={parser.id}>{parser.name}</option>)}
      </select></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!parsers || isUploading}>{isUploading ? 'Uploading…' : messages.upload.submit}</button>
    </form>
  </section>;
}

export function StatementDashboard() {
  const [statements, setStatements] = useState<StatementSummary[]>();
  const [error, setError] = useState<string>();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStatements = () => {
    setIsRefreshing(true);
    void fetch('/api/statements')
      .then(async (response) => {
        if (!response.ok) throw new Error(messages.dashboard.loadError);
        return response.json() as Promise<{ statements: StatementSummary[] }>;
      })
      .then((loaded) => { setStatements(loaded.statements); setError(undefined); })
      .catch(() => setError(messages.dashboard.loadError))
      .finally(() => setIsRefreshing(false));
  };

  useEffect(loadStatements, []);

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
    <header className="dashboard-header">
      <div><p className="eyebrow">Statement workspace</p><h1>{messages.dashboard.title}</h1><p>Review, categorize, and publish your imported statements.</p></div>
      <button type="button" onClick={loadStatements} disabled={isRefreshing}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</button>
    </header>
    <UploadForm />
    <section className="dashboard-stats" aria-label="Statement summary">
      <div className="stat-card"><strong>{grouped.attention.length}</strong><span>{messages.dashboard.needsAttention}</span></div>
      <div className="stat-card"><strong>{grouped.review.length}</strong><span>{messages.dashboard.review}</span></div>
      <div className="stat-card"><strong>{grouped.published.length}</strong><span>{messages.dashboard.published}</span></div>
    </section>
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

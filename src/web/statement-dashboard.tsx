import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { GroupedParserSelect, type ParserSelectOption } from './grouped-parser-select.js';
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

function StatementList({ statements, canDelete = true, showAttentionIcon = false, onDeleted }: { statements: StatementSummary[]; canDelete?: boolean; showAttentionIcon?: boolean; onDeleted?: () => void }) {
  const remove = async (statement: StatementSummary) => {
    if (!window.confirm(`Delete “${sourceName(statement)}”? This cannot be undone.`)) return;
    const response = await fetch(`/api/statements/${statement.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    if (!response.ok) {
      const result = await response.json() as { message?: string };
      window.alert(result.message ?? 'The statement could not be removed.');
      return;
    }
    onDeleted?.();
  };

  return <ul className="statement-list">
    {statements.map((statement) => {
      const range = dateRange(statement);
      return <li key={statement.id}>
        <div className={`statement-card${showAttentionIcon ? ' statement-card-attention' : ''}`}>
          <a className="statement-card-link" href={`?statementId=${encodeURIComponent(statement.id)}`}>
            {showAttentionIcon && <span className="statement-card-icon" aria-label="Needs attention" title="Needs attention">!</span>}
            <span className="statement-card-heading">{sourceName(statement)}</span>
          <span className="statement-card-meta">{statement.status}{statement.parserId ? ` · ${statement.parserId}` : ''}</span>
          <span className="statement-card-meta">{messages.dashboard.transactionCount(statement.transactionCount)}{range ? ` · ${range}` : ''}</span>
          {statement.paperlessCorrespondentName && <span className="statement-card-meta">Paperless-ngx · {statement.paperlessCorrespondentName}</span>}
          </a>
          {canDelete && <button className="statement-card-delete" type="button" aria-label={`Delete ${sourceName(statement)}`} title="Delete statement" onClick={() => void remove(statement)}>🗑</button>}
        </div>
      </li>;
    })}
  </ul>;
}

function UploadForm({ dataRevision }: { dataRevision: number }) {
  const [parsers, setParsers] = useState<ParserSelectOption[]>();
  const [file, setFile] = useState<File>();
  const [parserId, setParserId] = useState('');
  const [error, setError] = useState<string>();
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    void fetch('/api/parsers')
      .then(async (response) => {
        if (!response.ok) throw new Error(messages.upload.error);
        return response.json() as Promise<{ parsers: ParserSelectOption[] }>;
      })
      .then((loaded) => {
        setParsers(loaded.parsers);
        setParserId((current) => loaded.parsers.some((parser) => parser.id === current) ? current : '');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : messages.upload.error));
  }, [dataRevision]);

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
      <label>{messages.upload.chooseParser} <GroupedParserSelect ariaLabel={messages.upload.chooseParser} disabled={!parsers || isUploading} emptyLabel={messages.upload.chooseParser} parsers={parsers ?? []} value={parserId} onChange={(value) => { setParserId(value); setError(undefined); }} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!parsers || isUploading}>{isUploading ? 'Uploading…' : messages.upload.submit}</button>
    </form>
  </section>;
}

export function StatementDashboard({ dataRevision = 0 }: { dataRevision?: number }) {
  const [statements, setStatements] = useState<StatementSummary[]>();
  const [error, setError] = useState<string>();

  const loadStatements = () => {
    void fetch('/api/statements')
      .then(async (response) => {
        if (!response.ok) throw new Error(messages.dashboard.loadError);
        return response.json() as Promise<{ statements: StatementSummary[] }>;
      })
      .then((loaded) => { setStatements(loaded.statements); setError(undefined); })
      .catch(() => setError(messages.dashboard.loadError));
  };

  useEffect(() => { loadStatements(); }, [dataRevision]);
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
    <UploadForm dataRevision={dataRevision} />
    <section className="dashboard-stats" aria-label="Statement summary">
      <div className="stat-card"><strong>{grouped.attention.length}</strong><span>{messages.dashboard.needsAttention}</span></div>
      <div className="stat-card"><strong>{grouped.review.length}</strong><span>{messages.dashboard.review}</span></div>
      <div className="stat-card"><strong>{grouped.published.length}</strong><span>{messages.dashboard.published}</span></div>
    </section>
    {grouped.attention.length > 0 && <section aria-labelledby="attention-heading">
      <h2 id="attention-heading">{messages.dashboard.needsAttention}</h2>
      <StatementList statements={grouped.attention} showAttentionIcon onDeleted={loadStatements} />
    </section>}
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">{messages.dashboard.review} ({grouped.review.length})</h2>
      {grouped.review.length === 0 ? <p>{messages.dashboard.emptyReview}</p> : <StatementList statements={grouped.review} onDeleted={loadStatements} />}
    </section>
    <section aria-labelledby="published-heading">
      <h2 id="published-heading">{messages.dashboard.published}</h2>
      {grouped.published.length === 0 ? <p>{messages.dashboard.emptyPublished}</p> : <StatementList statements={grouped.published} onDeleted={loadStatements} />}
    </section>
  </main>;
}

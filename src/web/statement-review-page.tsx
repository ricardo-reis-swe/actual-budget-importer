import { useEffect, useMemo, useState } from 'react';

interface StatementTransaction {
  actualCategoryId: string | null;
  amountCents: number;
  date: string;
  description: string;
  excluded: boolean;
  id: number;
  reviewedAmountCents: number | null;
  reviewedDate: string | null;
  reviewedDescription: string | null;
}

interface StatementDetail {
  errorMessage: string | null;
  id: number;
  originalFilename: string | null;
  status: string;
  transactions: StatementTransaction[];
}

interface ReviewDraft {
  actualCategoryId: string;
  amountCents: string;
  date: string;
  description: string;
  excluded: boolean;
}

interface Category {
  id: string;
  name: string;
  groupId: string;
  hidden: boolean;
  deleted: boolean;
}

interface CategoryGroup {
  id: string;
  name: string;
  deleted: boolean;
  categories: Category[];
}

function toDraft(transaction: StatementTransaction): ReviewDraft {
  return {
    actualCategoryId: transaction.actualCategoryId ?? '',
    amountCents: String(transaction.reviewedAmountCents ?? transaction.amountCents),
    date: transaction.reviewedDate ?? transaction.date,
    description: transaction.reviewedDescription ?? transaction.description,
    excluded: transaction.excluded,
  };
}

function reviewUpdate(transaction: StatementTransaction, draft: ReviewDraft): Record<string, string | number | boolean | null> {
  const current = toDraft(transaction);
  const amountCents = Number(draft.amountCents);
  return {
    ...(draft.actualCategoryId !== current.actualCategoryId ? { actualCategoryId: draft.actualCategoryId || null } : {}),
    ...(draft.amountCents !== current.amountCents ? { reviewedAmountCents: amountCents } : {}),
    ...(draft.date !== current.date ? { reviewedDate: draft.date } : {}),
    ...(draft.description !== current.description ? { reviewedDescription: draft.description } : {}),
    ...(draft.excluded !== current.excluded ? { excluded: draft.excluded } : {}),
  };
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export function StatementReviewPage() {
  const [statement, setStatement] = useState<StatementDetail>();
  const [drafts, setDrafts] = useState<Record<number, ReviewDraft>>({});
  const [selectedTransactionId, setSelectedTransactionId] = useState<number>();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);

  useEffect(() => {
    const statementId = new URLSearchParams(window.location.search).get('statementId');
    if (!statementId) {
      setError('Select a statement to review.');
      return;
    }
    void fetch('/api/categories')
      .then(async (response) => response.ok ? response.json() as Promise<{ groups: CategoryGroup[] }> : { groups: [] })
      .then((loaded) => setCategoryGroups(loaded.groups));
    void fetch(`/api/statements/${encodeURIComponent(statementId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The statement could not be loaded.');
        return response.json() as Promise<StatementDetail>;
      })
      .then((loaded) => {
        setStatement(loaded);
        setDrafts(Object.fromEntries(loaded.transactions.map((transaction) => [transaction.id, toDraft(transaction)])));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The statement could not be loaded.'));
  }, []);

  const selectedTransaction = useMemo(
    () => statement?.transactions.find((transaction) => transaction.id === selectedTransactionId),
    [selectedTransactionId, statement],
  );
  const readOnly = statement?.status === 'published';
  const categories = categoryGroups.flatMap((group) => group.categories);

  if (error) return <main><p role="alert">{error}</p></main>;
  if (!statement) return <main><p>Loading statement…</p></main>;

  const updateDraft = (name: keyof ReviewDraft, value: string | boolean) => {
    if (!selectedTransaction) return;
    setDrafts((current) => ({ ...current, [selectedTransaction.id]: { ...current[selectedTransaction.id]!, [name]: value } }));
  };

  const requestConfirmation = () => {
    if (!selectedTransaction || readOnly) return;
    const update = reviewUpdate(selectedTransaction, drafts[selectedTransaction.id]!);
    if (Object.keys(update).length === 0) {
      setSelectedTransactionId(undefined);
      return;
    }
    if (Number.isNaN(Number(drafts[selectedTransaction.id]!.amountCents))) {
      setError('Enter an amount in cents.');
      return;
    }
    setIsSaving(true);
  };

  const confirmSave = () => {
    if (!selectedTransaction || !statement) return;
    const update = reviewUpdate(selectedTransaction, drafts[selectedTransaction.id]!);
    void fetch(`/api/statements/${statement.id}/transactions/${selectedTransaction.id}`, {
      body: JSON.stringify(update),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? 'Review changes could not be saved.');
      return response.json() as Promise<StatementTransaction>;
    }).then((updated) => {
      setStatement((current) => current && { ...current, transactions: current.transactions.map((transaction) => transaction.id === updated.id ? updated : transaction) });
      setSelectedTransactionId(undefined);
      setIsSaving(false);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Review changes could not be saved.');
      setIsSaving(false);
    });
  };

  return <main>
    <h1>{statement.originalFilename ?? `Statement ${statement.id}`}</h1>
    {statement.errorMessage && <p role="alert">{statement.errorMessage}</p>}
    {readOnly && <p role="status">This statement has been published and is read-only.</p>}
    <table>
      <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th><th>Included</th><th /></tr></thead>
      <tbody>{statement.transactions.map((transaction) => {
        const draft = drafts[transaction.id]!;
        return <tr key={transaction.id}>
          <td>{draft.date}</td><td>{draft.description}</td><td>{formatCents(Number(draft.amountCents))}</td>
          <td>{categories.find((category) => category.id === draft.actualCategoryId)?.name ?? (draft.actualCategoryId || 'Uncategorized')}
            {categories.find((category) => category.id === draft.actualCategoryId)?.deleted && ' (deleted)'}</td><td>{draft.excluded ? 'No' : 'Yes'}</td>
          <td>{!readOnly && <button type="button" onClick={() => { setSelectedTransactionId(transaction.id); setIsSaving(false); }}>Edit</button>}</td>
        </tr>;
      })}</tbody>
    </table>
    {selectedTransaction && <section aria-label="Edit transaction">
      <h2>{isSaving ? 'Confirm review changes' : 'Edit transaction'}</h2>
      {isSaving ? <>
        <p>Save these reviewed transaction values?</p>
        <button type="button" onClick={confirmSave}>Confirm changes</button>
        <button type="button" onClick={() => setIsSaving(false)}>Keep editing</button>
      </> : <>
        <label>Date <input value={drafts[selectedTransaction.id]!.date} onChange={(event) => updateDraft('date', event.target.value)} disabled={readOnly} /></label>
        <label>Description <input value={drafts[selectedTransaction.id]!.description} onChange={(event) => updateDraft('description', event.target.value)} disabled={readOnly} /></label>
        <label>Amount (cents) <input inputMode="numeric" value={drafts[selectedTransaction.id]!.amountCents} onChange={(event) => updateDraft('amountCents', event.target.value)} disabled={readOnly} /></label>
        <label>Category <select value={drafts[selectedTransaction.id]!.actualCategoryId} onChange={(event) => updateDraft('actualCategoryId', event.target.value)} disabled={readOnly}>
          <option value="">Uncategorized</option>
          {categoryGroups.map((group) => <optgroup key={group.id} label={group.name}>{group.categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.deleted ? ' (deleted)' : ''}{category.hidden ? ' (hidden)' : ''}</option>)}</optgroup>)}
        </select></label>
        <label><input type="checkbox" checked={drafts[selectedTransaction.id]!.excluded} onChange={(event) => updateDraft('excluded', event.target.checked)} disabled={readOnly} /> Exclude transaction</label>
        {!readOnly && <button type="button" onClick={requestConfirmation}>Review changes</button>}
      </>}
      <button type="button" onClick={() => { setSelectedTransactionId(undefined); setIsSaving(false); }}>Close</button>
    </section>}
  </main>;
}

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

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
  parserId: string | null;
  paperless: { correspondentName: string | null; documentDate: string | null };
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

function totalCents(statement: StatementDetail, drafts: Record<number, ReviewDraft>): number {
  return statement.transactions.reduce((total, transaction) => {
    const draft = drafts[transaction.id];
    return draft?.excluded ? total : total + Number(draft?.amountCents ?? transaction.amountCents);
  }, 0);
}

export function StatementReviewPage() {
  const [statement, setStatement] = useState<StatementDetail>();
  const [drafts, setDrafts] = useState<Record<number, ReviewDraft>>({});
  const [selectedTransactionId, setSelectedTransactionId] = useState<number>();
  const [editingField, setEditingField] = useState<keyof ReviewDraft>();
  const [ruleTransactionId, setRuleTransactionId] = useState<number>();
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState('');
  const [ruleParserId, setRuleParserId] = useState('');
  const [error, setError] = useState<string>();
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [rulesFeedback, setRulesFeedback] = useState('');

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

  const readOnly = statement?.status === 'published';
  const canPublish = statement?.status === 'ready for review' || statement?.status === 'publish failed';
  const categories = categoryGroups.flatMap((group) => group.categories);

  if (error) return <main><p role="alert">{error}</p></main>;
  if (!statement) return <main><p>Loading statement…</p></main>;

  const updateDraft = (transaction: StatementTransaction, name: keyof ReviewDraft, value: string | boolean) => {
    setDrafts((current) => ({ ...current, [transaction.id]: { ...current[transaction.id]!, [name]: value } }));
  };

  const saveInline = (transaction: StatementTransaction, draftOverride?: ReviewDraft) => {
    const draft = draftOverride ?? drafts[transaction.id]!;
    const update = reviewUpdate(transaction, draft);
    if (!Object.keys(update).length || !statement) return;
    void fetch(`/api/statements/${statement.id}/transactions/${transaction.id}`, { body: JSON.stringify(update), headers: { 'content-type': 'application/json' }, method: 'PATCH' })
      .then(async (response) => response.ok ? response.json() as Promise<StatementTransaction> : Promise.reject(new Error('Review changes could not be saved.')))
      .then((updated) => setStatement((current) => current && { ...current, transactions: current.transactions.map((item) => item.id === updated.id ? updated : item) }))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Review changes could not be saved.'));
  };

  const editCell = (transaction: StatementTransaction, field: keyof ReviewDraft) => {
    if (readOnly) return;
    setSelectedTransactionId(transaction.id);
    setEditingField(field);
  };

  const openRuleDialog = (transaction: StatementTransaction) => {
    if (readOnly) return;
    setRuleTransactionId(transaction.id);
    setRuleDescription(drafts[transaction.id]!.description);
    setRuleCategoryId(drafts[transaction.id]!.actualCategoryId);
    setRuleParserId('');
    setError(undefined);
  };

  const applyRules = async () => {
    if (!statement || readOnly) return;
    setIsApplyingRules(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/statements/${statement.id}/apply-rules`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? 'Rules could not be applied.');
      const result = await response.json() as { appliedCount: number; statement: StatementDetail };
      setStatement(result.statement);
      setDrafts(Object.fromEntries(result.statement.transactions.map((transaction) => [transaction.id, toDraft(transaction)])));
      setRulesFeedback(result.appliedCount > 0
        ? `Rules applied to ${result.appliedCount} ${result.appliedCount === 1 ? 'transaction' : 'transactions'}.`
        : 'Nothing changed — no uncategorized transactions matched your rules.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rules could not be applied.');
    } finally {
      setIsApplyingRules(false);
    }
  };

  const addRule = (applyToStatement: boolean) => {
    const transaction = statement?.transactions.find((item) => item.id === ruleTransactionId);
    if (!transaction) return;
    if (!ruleDescription.trim() || !ruleCategoryId) return;
    void fetch('/api/categorization-rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categoryId: ruleCategoryId, descriptionContains: ruleDescription.trim(), parserId: ruleParserId || null }) })
      .then(async (response) => {
        if (!response.ok) throw new Error('The categorization rule could not be added.');
        const current = statement?.transactions.find((item) => item.id === ruleTransactionId);
        if (current && statement) {
          const updatedDraft = { ...drafts[current.id]!, actualCategoryId: ruleCategoryId };
          const update = reviewUpdate(current, updatedDraft);
          if (Object.keys(update).length > 0) {
            const saved = await fetch(`/api/statements/${statement.id}/transactions/${current.id}`, { body: JSON.stringify(update), headers: { 'content-type': 'application/json' }, method: 'PATCH' });
            if (!saved.ok) throw new Error('The transaction category could not be saved.');
          }
          setDrafts((currentDrafts) => ({ ...currentDrafts, [current.id]: updatedDraft }));
        }
        if (applyToStatement) await applyRules();
        setRuleTransactionId(undefined);
        setRuleDescription('');
        setRuleCategoryId('');
        setRuleParserId('');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The categorization rule could not be added.'));
  };

  const publish = () => {
    if (!statement || !canPublish) return;
    setIsPublishing(true);
    setError(undefined);
    void fetch(`/api/statements/${statement.id}/publish`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? 'The statement could not be published.');
        setStatement((current) => current && { ...current, status: 'published' });
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'The statement could not be published.');
        setStatement((current) => current && { ...current, status: 'publish failed' });
      })
      .finally(() => setIsPublishing(false));
  };

  const selectCategory = (transaction: StatementTransaction, categoryId: string) => {
    const categoryDraft = drafts[transaction.id];
    if (!categoryDraft) return;
    const updatedDraft = { ...categoryDraft, actualCategoryId: categoryId };
    setDrafts((current) => ({ ...current, [transaction.id]: updatedDraft }));
    saveInline(transaction, updatedDraft);
  };

  return <main className="review-page">
    <a className="back-link" href="/">← Back to statements</a>
    <header className="review-header">
      <div><p className="eyebrow">Statement review</p><h1>{statement.originalFilename ?? `Statement ${statement.id}`}</h1>
        <p className="review-context">{statement.paperless.correspondentName ?? 'Uploaded statement'}{statement.parserId ? ` · ${statement.parserId}` : ''}{statement.paperless.documentDate ? ` · ${statement.paperless.documentDate}` : ''}</p>
      </div>
      <span className={`status-pill status-${statement.status.replaceAll(' ', '-')}`}>{statement.status}</span>
    </header>
    {statement.errorMessage && <p role="alert">{statement.errorMessage}</p>}
    {readOnly && <p role="status">This statement has been published and is read-only.</p>}
    <section className="review-summary" aria-label="Review summary"><div><strong>{statement.transactions.length}</strong><span>Transactions</span></div><div><strong>{statement.transactions.filter((transaction) => !drafts[transaction.id]?.excluded).length}</strong><span>Included</span></div><div><strong>{formatCents(totalCents(statement, drafts))}</strong><span>Included total</span></div></section>
    <div className="review-actions">{!readOnly && <button className="secondary-button" type="button" onClick={() => void applyRules()} disabled={isApplyingRules}>{isApplyingRules ? 'Applying rules…' : 'Apply rules'}</button>}{canPublish && <button type="button" onClick={publish} disabled={isPublishing}>{isPublishing ? 'Publishing…' : 'Publish statement'}</button>}</div>
    {rulesFeedback && <p className="rules-feedback" role="status">{rulesFeedback}</p>}
    <div className="transaction-table-wrap"><table className="transaction-table">
      <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th><th>Included</th><th /></tr></thead>
      <tbody>{statement.transactions.map((transaction) => {
        const draft = drafts[transaction.id]!;
        const isEditing = selectedTransactionId === transaction.id;
        const cell = (field: keyof ReviewDraft, value: ReactNode) => editingField === field && selectedTransactionId === transaction.id && !readOnly
          ? <input className="inline-editor" autoFocus value={draft[field] as string} onChange={(event) => updateDraft(transaction, field, event.target.value)} onBlur={() => { saveInline(transaction); setEditingField(undefined); }} /> : <button className="inline-cell" type="button" onClick={() => editCell(transaction, field)}>{value}</button>;
        const selectedCategory = categories.find((category) => category.id === draft.actualCategoryId);
        return <tr className={isEditing ? 'transaction-row-selected' : undefined} key={transaction.id}>
          <td>{cell('date', draft.date)}</td><td>{cell('description', draft.description)}</td><td>{cell('amountCents', formatCents(Number(draft.amountCents)))}</td>
          <td className="category-cell"><select className="category-select" aria-label={`Category for ${draft.description}`} disabled={readOnly} value={draft.actualCategoryId} onChange={(event) => selectCategory(transaction, event.target.value)}>
            {selectedCategory?.deleted && <option value={selectedCategory.id}>{selectedCategory.name} (deleted)</option>}
            <option value="">Uncategorized</option>{categoryGroups.filter((group) => !group.deleted).map((group) => <optgroup key={group.id} label={group.name}>{group.categories.filter((category) => !category.deleted).map((category) => <option key={category.id} value={category.id}>{category.name}{category.hidden ? ' (hidden)' : ''}</option>)}</optgroup>)}</select></td><td>{draft.excluded ? 'No' : 'Yes'}</td>
          <td className="row-actions">{!readOnly && <><button type="button" title={draft.excluded ? 'Include transaction' : 'Exclude transaction'} onClick={() => {
            const updatedDraft = { ...draft, excluded: !draft.excluded };
            setDrafts((current) => ({ ...current, [transaction.id]: updatedDraft }));
            saveInline(transaction, updatedDraft);
          }} aria-label={draft.excluded ? 'Include transaction' : 'Exclude transaction'}>{draft.excluded ? '✓' : '⊘'}</button><button type="button" title="Add categorization rule" aria-label="Add categorization rule" onClick={() => openRuleDialog(transaction)}>＋</button></>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {ruleTransactionId && <div className="dialog-backdrop" role="presentation"><section className="rule-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-dialog-title"><h2 id="rule-dialog-title">Create categorization rule</h2><p>New transactions whose description contains this text will use the selected category.</p><form onSubmit={(event) => { event.preventDefault(); addRule(false); }}><label htmlFor="rule-description">Description contains<input autoFocus id="rule-description" value={ruleDescription} onChange={(event) => setRuleDescription(event.target.value)} /></label><label htmlFor="rule-category">Category<select id="rule-category" value={ruleCategoryId} onChange={(event) => setRuleCategoryId(event.target.value)}><option value="">Select a category</option>{categoryGroups.filter((group) => !group.deleted).map((group) => <optgroup key={group.id} label={group.name}>{group.categories.filter((category) => !category.deleted).map((category) => <option key={category.id} value={category.id}>{category.name}{category.hidden ? ' (hidden)' : ''}</option>)}</optgroup>)}</select></label><label htmlFor="rule-scope">Apply rule to<select id="rule-scope" value={ruleParserId} onChange={(event) => setRuleParserId(event.target.value)}><option value="">All statements</option>{statement.parserId && <option value={statement.parserId}>Only {statement.parserId} statements</option>}</select></label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setRuleTransactionId(undefined); setRuleDescription(''); setRuleCategoryId(''); setRuleParserId(''); }}>Cancel</button><button type="submit" disabled={!ruleDescription.trim() || !ruleCategoryId}>Create rule</button><button type="button" disabled={!ruleDescription.trim() || !ruleCategoryId} onClick={() => addRule(true)}>Create and apply to this statement</button></div></form></section></div>}
  </main>;
}

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
  actualAccount: { id: string; name: string | null } | null;
  errorMessage: string | null;
  id: number;
  originalFilename: string | null;
  status: string;
  transactions: StatementTransaction[];
  parserId: string | null;
  paperless: { correspondentName: string | null; documentDate: string | null; documentId: number | null };
}

interface ParserOption { id: string; name: string }
interface ActualAccount { closed: boolean; id: string; name: string; offBudget: boolean }

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
  const [ruleInclusion, setRuleInclusion] = useState('');
  const [ruleParserId, setRuleParserId] = useState('');
  const [applyRuleToStatement, setApplyRuleToStatement] = useState(true);
  const [error, setError] = useState<string>();
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [accounts, setAccounts] = useState<ActualAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishError, setPublishError] = useState<string>();
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [rulesFeedback, setRulesFeedback] = useState('');
  const [parsers, setParsers] = useState<ParserOption[]>([]);
  const [selectedParserId, setSelectedParserId] = useState('');
  const [parserFile, setParserFile] = useState<File>();
  const [isChangingParser, setIsChangingParser] = useState(false);
  const [parserError, setParserError] = useState<string>();

  useEffect(() => {
    const statementId = new URLSearchParams(window.location.search).get('statementId');
    if (!statementId) {
      setError('Select a statement to review.');
      return;
    }
    void fetch('/api/categories')
      .then(async (response) => response.ok ? response.json() as Promise<{ groups: CategoryGroup[] }> : { groups: [] })
      .then((loaded) => setCategoryGroups(loaded.groups));
    void fetch('/api/parsers')
      .then(async (response) => response.ok ? response.json() as Promise<{ parsers: ParserOption[] }> : { parsers: [] })
      .then((loaded) => setParsers(loaded.parsers));
    void fetch(`/api/statements/${encodeURIComponent(statementId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('The statement could not be loaded.');
        return response.json() as Promise<StatementDetail>;
      })
      .then((loaded) => {
        setStatement(loaded);
        setSelectedParserId(loaded.parserId ?? '');
        setDrafts(Object.fromEntries(loaded.transactions.map((transaction) => [transaction.id, toDraft(transaction)])));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The statement could not be loaded.'));
  }, []);

  const readOnly = statement?.status === 'published';
  const canPublish = statement?.status === 'ready for review' || statement?.status === 'publish failed';
  const categories = categoryGroups.flatMap((group) => group.categories);

  if (error) return <main><p role="alert">{error}</p></main>;
  if (!statement) return <main><p>Loading statement…</p></main>;

  const includedTransactions = statement.transactions.filter((transaction) => !drafts[transaction.id]?.excluded);
  const inflowCents = includedTransactions.reduce((total, transaction) => {
    const amount = Number(drafts[transaction.id]?.amountCents ?? transaction.amountCents);
    return amount > 0 ? total + amount : total;
  }, 0);
  const outflowCents = Math.abs(includedTransactions.reduce((total, transaction) => {
    const amount = Number(drafts[transaction.id]?.amountCents ?? transaction.amountCents);
    return amount < 0 ? total + amount : total;
  }, 0));

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
    setRuleInclusion('');
    setApplyRuleToStatement(true);
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
        : 'Nothing changed — no transactions needed updates from your rules.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rules could not be applied.');
    } finally {
      setIsApplyingRules(false);
    }
  };

  const addRule = (applyToStatement: boolean) => {
    const transaction = statement?.transactions.find((item) => item.id === ruleTransactionId);
    if (!transaction) return;
    if (!ruleDescription.trim() || (!ruleCategoryId && !ruleInclusion)) return;
    const excluded = ruleInclusion === 'exclude' ? true : ruleInclusion === 'include' ? false : null;
    void fetch('/api/categorization-rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ categoryId: ruleCategoryId || null, descriptionContains: ruleDescription.trim(), excluded, parserId: ruleParserId || null }) })
      .then(async (response) => {
        if (!response.ok) throw new Error('The transaction rule could not be added.');
        const current = statement?.transactions.find((item) => item.id === ruleTransactionId);
        if (current && statement) {
          const updatedDraft = {
            ...drafts[current.id]!,
            ...(ruleCategoryId ? { actualCategoryId: ruleCategoryId } : {}),
            ...(excluded === null ? {} : { excluded }),
          };
          const update = reviewUpdate(current, updatedDraft);
          if (Object.keys(update).length > 0) {
            const saved = await fetch(`/api/statements/${statement.id}/transactions/${current.id}`, { body: JSON.stringify(update), headers: { 'content-type': 'application/json' }, method: 'PATCH' });
            if (!saved.ok) throw new Error('The transaction rule effects could not be saved.');
            const savedTransaction = await saved.json() as StatementTransaction;
            setStatement((currentStatement) => currentStatement && {
              ...currentStatement,
              transactions: currentStatement.transactions.map((item) => item.id === savedTransaction.id ? savedTransaction : item),
            });
          }
          setDrafts((currentDrafts) => ({ ...currentDrafts, [current.id]: updatedDraft }));
        }
        if (applyToStatement) await applyRules();
        setRuleTransactionId(undefined);
        setRuleDescription('');
        setRuleCategoryId('');
        setRuleInclusion('');
        setRuleParserId('');
        setApplyRuleToStatement(true);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The transaction rule could not be added.'));
  };

  const openPublishDialog = async () => {
    if (!statement || !canPublish) return;
    setPublishDialogOpen(true);
    setPublishError(undefined);
    setSelectedAccountId(statement.actualAccount?.id ?? '');
    setIsLoadingAccounts(true);
    try {
      const response = await fetch('/api/actual/accounts');
      if (!response.ok) throw new Error('Actual Budget accounts could not be loaded.');
      const loaded = await response.json() as { accounts: ActualAccount[] };
      setAccounts(loaded.accounts);
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : 'Actual Budget accounts could not be loaded.');
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const publish = async () => {
    if (!statement || !canPublish || !selectedAccountId) return;
    const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
    const destination = statement.actualAccount
      ?? (selectedAccount ? { id: selectedAccount.id, name: selectedAccount.name } : null);
    if (!destination) return;
    setIsPublishing(true);
    setPublishError(undefined);
    try {
      const response = await fetch(`/api/statements/${statement.id}/publish`, {
        body: JSON.stringify({ accountId: selectedAccountId, confirm: true }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error((await response.json() as { message?: string }).message ?? 'The statement could not be published.');
      setStatement((current) => current && { ...current, actualAccount: destination, status: 'published' });
      setPublishDialogOpen(false);
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : 'The statement could not be published.');
      const refreshed = await fetch(`/api/statements/${statement.id}`)
        .then((response) => response.ok ? response.json() as Promise<StatementDetail> : undefined)
        .catch(() => undefined);
      if (refreshed) setStatement(refreshed);
    } finally {
      setIsPublishing(false);
    }
  };

  const selectCategory = (transaction: StatementTransaction, categoryId: string) => {
    const categoryDraft = drafts[transaction.id];
    if (!categoryDraft) return;
    const updatedDraft = { ...categoryDraft, actualCategoryId: categoryId };
    setDrafts((current) => ({ ...current, [transaction.id]: updatedDraft }));
    saveInline(transaction, updatedDraft);
  };

  const changeParser = async () => {
    if (!selectedParserId || selectedParserId === statement.parserId) return;
    const isInitialSelection = statement.parserId === null && statement.transactions.length === 0;
    if (!isInitialSelection && !window.confirm('Changing the parser permanently deletes all extracted transactions and review changes for this statement. Continue?')) return;
    setIsChangingParser(true);
    setParserError(undefined);
    try {
      let response: Response;
      if (statement.paperless.documentId !== null) {
        response = await fetch(`/api/statements/${statement.id}/paperless/parser`, {
          body: JSON.stringify({ confirm: !isInitialSelection, parserId: selectedParserId }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
      } else {
        if (!parserFile) throw new Error('Select the original PDF before changing this parser.');
        const form = new FormData();
        form.append('parserId', selectedParserId);
        form.append('confirm', 'true');
        form.append('file', parserFile);
        response = await fetch(`/api/statements/${statement.id}/parser`, { body: form, method: 'POST' });
      }
      const result = response.status === 204 ? undefined : await response.json() as { message?: string; status?: string };
      if (!response.ok) throw new Error(result?.message ?? 'The parser could not be changed.');
      window.location.reload();
    } catch (cause) {
      setParserError(cause instanceof Error ? cause.message : 'The parser could not be changed.');
      setIsChangingParser(false);
    }
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
    {statement.actualAccount && <p role="status">Destination account: <strong>{statement.actualAccount.name ?? statement.actualAccount.id}</strong></p>}
    {!readOnly && <section className="parser-assignment" aria-labelledby="statement-parser-heading">
      <div><h2 id="statement-parser-heading">Statement parser</h2><p>{statement.parserId ? 'Choose another parser to re-extract this statement.' : 'Choose a parser to extract this Paperless-ngx statement.'}</p></div>
      <label>Parser<select value={selectedParserId} onChange={(event) => { setSelectedParserId(event.target.value); setParserError(undefined); }}>
        <option value="">Select a parser</option>
        {statement.parserId && !parsers.some((parser) => parser.id === statement.parserId) && <option value={statement.parserId}>{statement.parserId} (hidden)</option>}
        {parsers.map((parser) => <option key={parser.id} value={parser.id}>{parser.name}</option>)}
      </select></label>
      {statement.paperless.documentId === null && selectedParserId !== statement.parserId && <label>Original PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => setParserFile(event.target.files?.[0])} /></label>}
      <button type="button" disabled={!selectedParserId || selectedParserId === statement.parserId || isChangingParser} onClick={() => void changeParser()}>{isChangingParser ? 'Changing parser…' : statement.parserId ? 'Change parser' : 'Use parser'}</button>
      {parserError && <p role="alert">{parserError}</p>}
    </section>}
    <section className="review-summary" aria-label="Review summary"><div><strong>{statement.transactions.length}</strong><span>Transactions</span></div><div><strong>{statement.transactions.filter((transaction) => !drafts[transaction.id]?.excluded).length}</strong><span>Included</span></div><div><strong>{formatCents(totalCents(statement, drafts))}</strong><span>Included total</span></div></section>
    <div className="review-actions">{!readOnly && <button className="secondary-button" type="button" onClick={() => void applyRules()} disabled={isApplyingRules}>{isApplyingRules ? 'Applying rules…' : 'Apply rules'}</button>}{canPublish && <button type="button" onClick={() => void openPublishDialog()} disabled={isPublishing}>{isPublishing ? 'Publishing…' : 'Publish statement'}</button>}</div>
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
          }} aria-label={draft.excluded ? 'Include transaction' : 'Exclude transaction'}>{draft.excluded ? '✓' : '⊘'}</button><button type="button" title="Add transaction rule" aria-label="Add transaction rule" onClick={() => openRuleDialog(transaction)}>＋</button></>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {publishDialogOpen && <div className="dialog-backdrop" role="presentation"><section className="rule-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title"><h2 id="publish-dialog-title">Publish statement</h2><p>Confirm the transactions and destination account before publishing.</p><form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
      <dl className="publish-summary"><div><dt>Included</dt><dd>{includedTransactions.length}</dd></div><div><dt>Excluded</dt><dd>{statement.transactions.length - includedTransactions.length}</dd></div><div><dt>Inflows</dt><dd>{formatCents(inflowCents)}</dd></div><div><dt>Outflows</dt><dd>{formatCents(outflowCents)}</dd></div></dl>
      <label htmlFor="publish-account">Destination account<select id="publish-account" disabled={isLoadingAccounts || statement.actualAccount !== null} value={selectedAccountId} onChange={(event) => { setSelectedAccountId(event.target.value); setPublishError(undefined); }}><option value="">Select an account</option>{statement.actualAccount && !accounts.some((account) => account.id === statement.actualAccount!.id) && <option value={statement.actualAccount.id}>{statement.actualAccount.name ?? statement.actualAccount.id}</option>}{accounts.filter((account) => !account.closed).map((account) => <option key={account.id} value={account.id}>{account.name}{account.offBudget ? ' (off budget)' : ''}</option>)}</select></label>
      {statement.actualAccount && <p>This account is locked because a publication attempt has already started.</p>}
      {isLoadingAccounts && <p role="status">Loading accounts…</p>}
      {publishError && <p role="alert">{publishError}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={isPublishing} onClick={() => setPublishDialogOpen(false)}>Cancel</button><button type="submit" disabled={isPublishing || isLoadingAccounts || !selectedAccountId || Boolean(publishError)}>{isPublishing ? 'Publishing…' : 'Confirm and publish'}</button></div>
    </form></section></div>}
    {ruleTransactionId && <div className="dialog-backdrop" role="presentation"><section className="rule-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-dialog-title"><h2 id="rule-dialog-title">Create transaction rule</h2><p>Choose what should happen when a transaction description contains this text.</p><form onSubmit={(event) => { event.preventDefault(); addRule(applyRuleToStatement); }}><label htmlFor="rule-description">Description contains<input autoFocus id="rule-description" value={ruleDescription} onChange={(event) => setRuleDescription(event.target.value)} /></label><label htmlFor="rule-category">Category<select id="rule-category" value={ruleCategoryId} onChange={(event) => setRuleCategoryId(event.target.value)}><option value="">Leave category unchanged</option>{categoryGroups.filter((group) => !group.deleted).map((group) => <optgroup key={group.id} label={group.name}>{group.categories.filter((category) => !category.deleted).map((category) => <option key={category.id} value={category.id}>{category.name}{category.hidden ? ' (hidden)' : ''}</option>)}</optgroup>)}</select></label><label htmlFor="rule-inclusion">Publishing<select id="rule-inclusion" value={ruleInclusion} onChange={(event) => setRuleInclusion(event.target.value)}><option value="">Leave inclusion unchanged</option><option value="include">Include transaction</option><option value="exclude">Exclude transaction</option></select></label><label htmlFor="rule-scope">Apply rule to<select id="rule-scope" value={ruleParserId} onChange={(event) => setRuleParserId(event.target.value)}><option value="">All statements</option>{statement.parserId && <option value={statement.parserId}>Only {statement.parserId} statements</option>}</select></label><label className="rule-apply-to-statement"><input type="checkbox" checked={applyRuleToStatement} onChange={(event) => setApplyRuleToStatement(event.target.checked)} />Run new rule on the entire statement</label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setRuleTransactionId(undefined); setRuleDescription(''); setRuleCategoryId(''); setRuleInclusion(''); setRuleParserId(''); setApplyRuleToStatement(true); }}>Cancel</button><button type="submit" disabled={!ruleDescription.trim() || (!ruleCategoryId && !ruleInclusion)}>Create rule</button></div></form></section></div>}
  </main>;
}

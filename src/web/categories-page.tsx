import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { GroupedCategorySelect } from './grouped-category-select.js';

interface Category { id: string; name: string; deleted: boolean; hidden: boolean }
interface Group { id: string; name: string; deleted: boolean; categories: Category[] }

export function CategoriesPage({ onDataChanged }: { onDataChanged?: () => void } = {}) {
  const [groups, setGroups] = useState<Group[]>();
  const [groupName, setGroupName] = useState('');
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string>();
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [error, setError] = useState('');
  const [managingCategoryId, setManagingCategoryId] = useState<string>();
  const [savingCategoryGroupId, setSavingCategoryGroupId] = useState<string>();
  const [savingGroup, setSavingGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string>();
  const [editingGroupName, setEditingGroupName] = useState('');
  const [removingCategory, setRemovingCategory] = useState<Category>();
  const [transferCategoryId, setTransferCategoryId] = useState('');

  const load = () => fetch('/api/categories/refresh', { method: 'POST' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Categories could not be synchronized with Actual Budget.');
      return response.json() as Promise<{ groups: Group[] }>;
    })
    .then((result) => setGroups(result.groups))
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Categories could not be loaded.'));

  useEffect(() => { void load(); }, []);

  const createGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.confirm(`Create the category group “${groupName.trim()}” in Actual Budget?`)) return;
    setSavingGroup(true);
    setError('');
    try {
      const response = await fetch('/api/category-groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true, name: groupName }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category group could not be created.');
      } else {
        const created = await response.json() as { id: string; name: string };
        setGroups((current) => [...(current ?? []), { ...created, deleted: false, categories: [] }]);
        setGroupName('');
        onDataChanged?.();
      }
    } catch {
      setError('Category group could not be created.');
    } finally {
      setSavingGroup(false);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>, groupId: string) => {
    event.preventDefault();
    const name = categoryNames[groupId] ?? '';
    if (!name.trim()) return;
    setSavingCategoryGroupId(groupId);
    setError('');
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true, groupId, name }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category could not be created.');
      } else {
        const created = await response.json() as { id: string; name: string };
        setGroups((current) => current?.map((group) => group.id === groupId
          ? { ...group, categories: [...group.categories, { id: created.id, name: created.name, deleted: false, hidden: false }] }
          : group));
        setCategoryNames((current) => ({ ...current, [groupId]: '' }));
        onDataChanged?.();
      }
    } catch {
      setError('Category could not be created.');
    } finally {
      setSavingCategoryGroupId(undefined);
    }
  };

  const update = async (categoryId: string, groupId?: string) => {
    if (!editingCategoryName.trim()) return;
    setManagingCategoryId(categoryId);
    setError('');
    try {
      const response = await fetch(`/api/categories/${encodeURIComponent(categoryId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(groupId === undefined ? { name: editingCategoryName } : { groupId, name: editingCategoryName }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category could not be updated.');
      } else {
        const updated = await response.json() as { id: string; name: string };
        setGroups((current) => {
          const moved = current?.flatMap((group) => group.categories).find((category) => category.id === updated.id);
          return current?.map((group) => {
            const categories = group.categories.map((category) => category.id === updated.id
              ? { ...category, name: updated.name }
              : category);
            if (groupId === undefined || !moved) return { ...group, categories };
            const others = categories.filter((category) => category.id !== updated.id);
            return { ...group, categories: group.id === groupId ? [...others, { ...moved, name: updated.name }] : others };
          });
        });
        setEditingCategoryId(undefined);
        setEditingCategoryName('');
        onDataChanged?.();
      }
    } catch {
      setError('Category could not be updated.');
    } finally {
      setManagingCategoryId(undefined);
    }
  };

  const updateGroup = async (event: FormEvent<HTMLFormElement>, groupId: string) => {
    event.preventDefault();
    if (!editingGroupName.trim()) return;
    setSavingCategoryGroupId(groupId);
    setError('');
    try {
      const response = await fetch(`/api/category-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editingGroupName }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category group could not be renamed.');
      } else {
        const updated = await response.json() as { id: string; name: string };
        setGroups((current) => current?.map((group) => group.id === updated.id ? { ...group, name: updated.name } : group));
        setEditingGroupId(undefined);
        setEditingGroupName('');
        onDataChanged?.();
      }
    } catch {
      setError('Category group could not be renamed.');
    } finally {
      setSavingCategoryGroupId(undefined);
    }
  };

  const closeRemoval = () => {
    setRemovingCategory(undefined);
    setTransferCategoryId('');
  };

  const remove = async (category: Category) => {
    setManagingCategoryId(category.id);
    setError('');
    try {
      const response = await fetch(`/api/categories/${encodeURIComponent(category.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(transferCategoryId ? { confirmed: true, transferCategoryId } : { confirmed: true }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category could not be removed.');
      } else {
        setGroups((current) => current?.map((group) => ({
          ...group,
          categories: group.categories.filter((item) => item.id !== category.id),
        })));
        if (editingCategoryId === category.id) {
          setEditingCategoryId(undefined);
          setEditingCategoryName('');
        }
        closeRemoval();
        onDataChanged?.();
      }
    } catch {
      setError('Category could not be removed.');
    } finally {
      setManagingCategoryId(undefined);
    }
  };

  return <main>
    {error && <p role="alert">{error}</p>}
    <section>
      <h2>Create a category group</h2>
      <form onSubmit={createGroup}>
        <label>Group name <input value={groupName} onChange={(event) => setGroupName(event.target.value)} required /></label>
        <button type="submit" disabled={savingGroup}>{savingGroup ? 'Creating…' : 'Create category group'}</button>
      </form>
    </section>
    <section>
      <h2>Categories</h2>
      {!groups
        ? <p>Loading categories…</p>
        : groups.length === 0
          ? <p>No categories found. Refresh Actual Budget categories and try again.</p>
          : <div className="category-groups">{groups.filter((group) => !group.deleted).map((group) => {
            const activeCategories = group.categories.filter((category) => !category.deleted);
            return <section className="category-group" key={group.id}>
              {editingGroupId === group.id
                ? <form className="category-group-edit-form" onSubmit={(event) => void updateGroup(event, group.id)}>
                  <input autoFocus aria-label={`Rename group ${group.name}`} value={editingGroupName} onChange={(event) => setEditingGroupName(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEditingGroupId(undefined);
                      setEditingGroupName('');
                    }
                  }} disabled={savingCategoryGroupId !== undefined} required />
                </form>
                : <h3><button type="button" className="category-group-name" title="Rename group" disabled={savingCategoryGroupId !== undefined || managingCategoryId !== undefined} onClick={() => { setEditingGroupId(group.id); setEditingGroupName(group.name); }}>{group.name}</button></h3>}
              <ul className="category-list">{activeCategories.map((category) => <li key={category.id}>
                  {editingCategoryId === category.id
                    ? <form className="category-edit-form" onSubmit={(event) => { event.preventDefault(); void update(category.id); }}>
                      <input className="category-name-input" autoFocus aria-label={`Edit ${category.name}`} value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditingCategoryId(undefined);
                          setEditingCategoryName('');
                        }
                      }} disabled={managingCategoryId !== undefined} required />
                      <select className="category-group-select" aria-label={`Group for ${category.name}`} value={group.id} disabled={managingCategoryId !== undefined} onChange={(event) => void update(category.id, event.target.value)}>
                        {groups.filter((item) => !item.deleted).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </form>
                    : <button type="button" className="category-item-name" disabled={managingCategoryId !== undefined} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}>
                      <span>{category.name}</span>{category.hidden && <span className="category-hidden">Hidden</span>}
                    </button>}
                  <button type="button" className="statement-card-delete category-delete-button" disabled={managingCategoryId !== undefined} aria-label={`Delete ${category.name}`} title="Delete category" onClick={() => setRemovingCategory(category)}>🗑</button>
                </li>)}
                <li className="category-new-row">
                  <form className="category-create-form" onSubmit={(event) => void create(event, group.id)}>
                    <input aria-label={`New category in ${group.name}`} value={categoryNames[group.id] ?? ''} onChange={(event) => setCategoryNames((current) => ({ ...current, [group.id]: event.target.value }))} disabled={savingCategoryGroupId !== undefined || managingCategoryId !== undefined} required />
                  </form>
                </li>
              </ul>
            </section>;
          })}</div>}
    </section>
    {removingCategory && groups && <div className="dialog-backdrop" role="presentation"><section className="rule-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-category-title" onKeyDown={(event) => { if (event.key === 'Escape') closeRemoval(); }}>
      <h2 id="remove-category-title">Remove “{removingCategory.name}”</h2>
      <p>The category will be removed from Actual Budget. Choose a category to receive its transactions and rules, or leave them uncategorized.</p>
      <form onSubmit={(event) => { event.preventDefault(); void remove(removingCategory); }}>
        <label htmlFor="remove-category-transfer">Move transactions to<GroupedCategorySelect id="remove-category-transfer" emptyLabel="Leave them uncategorized" groups={groups.map((group) => ({ ...group, categories: group.categories.filter((category) => category.id !== removingCategory.id && !category.hidden) }))} value={transferCategoryId} onChange={setTransferCategoryId} /></label>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={closeRemoval}>Cancel</button>
          <button type="submit" disabled={managingCategoryId !== undefined}>{transferCategoryId ? 'Merge and remove' : 'Remove category'}</button>
        </div>
      </form>
    </section></div>}
  </main>;
}

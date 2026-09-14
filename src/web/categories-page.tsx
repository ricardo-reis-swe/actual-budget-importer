import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface Category { id: string; name: string; deleted: boolean; hidden: boolean }
interface Group { id: string; name: string; deleted: boolean; categories: Category[] }

export function CategoriesPage() {
  const [groups, setGroups] = useState<Group[]>();
  const [groupName, setGroupName] = useState('');
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string>();
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [error, setError] = useState('');
  const [managingCategoryId, setManagingCategoryId] = useState<string>();
  const [savingCategoryGroupId, setSavingCategoryGroupId] = useState<string>();
  const [savingGroup, setSavingGroup] = useState(false);

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
      }
    } catch {
      setError('Category could not be created.');
    } finally {
      setSavingCategoryGroupId(undefined);
    }
  };

  const update = async (event: FormEvent<HTMLFormElement>, categoryId: string) => {
    event.preventDefault();
    if (!editingCategoryName.trim()) return;
    setManagingCategoryId(categoryId);
    setError('');
    try {
      const response = await fetch(`/api/categories/${encodeURIComponent(categoryId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: editingCategoryName }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { message?: string }).message ?? 'Category could not be renamed.');
      } else {
        const updated = await response.json() as { id: string; name: string };
        setGroups((current) => current?.map((group) => ({
          ...group,
          categories: group.categories.map((category) => category.id === updated.id
            ? { ...category, name: updated.name }
            : category),
        })));
        setEditingCategoryId(undefined);
        setEditingCategoryName('');
      }
    } catch {
      setError('Category could not be renamed.');
    } finally {
      setManagingCategoryId(undefined);
    }
  };

  const remove = async (category: Category) => {
    if (!window.confirm(`Remove the category “${category.name}” from Actual Budget? This can affect transactions that use it.`)) return;
    setManagingCategoryId(category.id);
    setError('');
    try {
      const response = await fetch(`/api/categories/${encodeURIComponent(category.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
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
              <h3>{group.name}</h3>
              <ul className="category-list">{activeCategories.map((category) => <li key={category.id}>
                  {editingCategoryId === category.id
                    ? <form className="category-edit-form" onSubmit={(event) => void update(event, category.id)}>
                      <input className="category-name-input" autoFocus aria-label={`Edit ${category.name}`} value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditingCategoryId(undefined);
                          setEditingCategoryName('');
                        }
                      }} disabled={managingCategoryId !== undefined} required />
                    </form>
                    : <button type="button" className="category-item-name" disabled={managingCategoryId !== undefined} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}>
                      <span>{category.name}</span>{category.hidden && <span className="category-hidden">Hidden</span>}
                    </button>}
                  <button type="button" className="statement-card-delete category-delete-button" disabled={managingCategoryId !== undefined} aria-label={`Delete ${category.name}`} title="Delete category" onClick={() => void remove(category)}>🗑</button>
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
  </main>;
}

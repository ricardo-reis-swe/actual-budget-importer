import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface Category { id: string; name: string; deleted: boolean; hidden: boolean }
interface Group { id: string; name: string; deleted: boolean; categories: Category[] }

export function CategoriesPage() {
  const [groups, setGroups] = useState<Group[]>();
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => fetch('/api/categories/refresh', { method: 'POST' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Categories could not be synchronized with Actual Budget.');
      return response.json() as Promise<{ groups: Group[] }>;
    })
    .then((result) => setGroups(result.groups))
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Categories could not be loaded.'));

  useEffect(() => { void load(); }, []);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
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
      setName('');
    }
    setSaving(false);
  };

  return <main>
    <section>
      <h2>Create a category</h2>
      <form onSubmit={create}>
        <label>Category group <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required><option value="">Select a group</option>{groups?.filter((group) => !group.deleted).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Category name <input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <button type="submit" disabled={saving || !groups}>{saving ? 'Creating…' : 'Create category'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
    <section><h2>Categories</h2>{!groups ? <p>Loading categories…</p> : groups.length === 0 ? <p>No categories found. Refresh Actual Budget categories and try again.</p> : <div className="category-groups">{groups.filter((group) => !group.deleted).map((group) => <section className="category-group" key={group.id}><h3>{group.name}</h3>{group.categories.filter((category) => !category.deleted).length === 0 ? <p className="category-empty">No active categories.</p> : <ul className="category-list">{group.categories.filter((category) => !category.deleted).map((category) => <li key={category.id}><span>{category.name}</span>{category.hidden && <span className="category-hidden">Hidden</span>}</li>)}</ul>}</section>)}</div>}</section>
  </main>;
}

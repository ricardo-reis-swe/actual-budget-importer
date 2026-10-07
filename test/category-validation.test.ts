import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { isCategoryAvailable } from '../src/categories/category-validation.js';
import { GroupedCategorySelect } from '../src/web/grouped-category-select.js';

const groups = [{ id: 'group', name: 'Expenses', deleted: false, categories: [
  { id: 'current', name: 'Bills', deleted: false },
  { id: 'hidden', name: 'Hidden', deleted: false, hidden: true },
  { id: 'deleted', name: 'Bills', deleted: true },
] }];

describe('category availability', () => {
  it('distinguishes a deleted category from a current category with the same name', () => {
    expect(isCategoryAvailable(groups, 'current')).toBe(true);
    expect(isCategoryAvailable(groups, 'deleted')).toBe(false);
    expect(isCategoryAvailable(groups, 'unknown')).toBe(false);
    expect(isCategoryAvailable(groups, 'hidden')).toBe(true);
    expect(isCategoryAvailable(groups, null)).toBe(true);
    expect(isCategoryAvailable(groups, '')).toBe(true);
    expect(isCategoryAvailable([{ ...groups[0]!, deleted: true }], 'current')).toBe(false);
  });

  it('keeps deleted and missing category assignments visible instead of displaying Uncategorized', () => {
    for (const id of ['deleted', 'unknown']) {
      const markup = renderToStaticMarkup(createElement(GroupedCategorySelect, {
        groups, value: id, emptyLabel: 'Uncategorized', onChange: () => undefined,
      }));
      expect(markup).toContain('(deleted)');
      expect(markup).toContain(id === 'deleted' ? 'Bills' : 'unknown');
    }
  });
});

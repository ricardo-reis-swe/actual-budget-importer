import { describe, expect, it, vi } from 'vitest';

import {
  CategoryCreation,
  CategoryCreationError,
} from '../src/categories/category-creation.js';

describe('category creation', () => {
  it('creates a category in the selected group only after confirmation', async () => {
    const actualBudget = { createCategory: vi.fn().mockResolvedValue({ id: 'category-1', name: 'Groceries' }) };
    const creation = new CategoryCreation(actualBudget);

    await expect(creation.create({ confirmed: false, groupId: 'group-1', name: 'Groceries' }))
      .rejects.toMatchObject({ code: 'CATEGORY_CREATION_NOT_CONFIRMED' });
    expect(actualBudget.createCategory).not.toHaveBeenCalled();

    await expect(creation.create({ confirmed: true, groupId: ' group-1 ', name: ' Groceries ' }))
      .resolves.toEqual({ id: 'category-1', name: 'Groceries' });
    expect(actualBudget.createCategory).toHaveBeenCalledWith('group-1', 'Groceries');
  });

  it('requires a category group and name', async () => {
    const creation = new CategoryCreation({ createCategory: vi.fn() });

    await expect(creation.create({ confirmed: true, groupId: ' ', name: 'Groceries' }))
      .rejects.toEqual(new CategoryCreationError('INVALID_CATEGORY_GROUP'));
    await expect(creation.create({ confirmed: true, groupId: 'group-1', name: ' ' }))
      .rejects.toEqual(new CategoryCreationError('INVALID_CATEGORY_NAME'));
  });
});

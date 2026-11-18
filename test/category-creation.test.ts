import { describe, expect, it, vi } from 'vitest';

import {
  CategoryCreation,
  CategoryCreationError,
} from '../src/categories/category-creation.js';

describe('category creation', () => {
  it('creates a category in the selected group only after confirmation', async () => {
    const actualBudget = {
      createCategory: vi.fn().mockResolvedValue({ id: 'category-1', name: 'Groceries' }),
      createCategoryGroup: vi.fn(),
      deleteCategory: vi.fn(),
      updateCategory: vi.fn(),
      updateCategoryGroup: vi.fn(),
    };
    const creation = new CategoryCreation(actualBudget);

    await expect(creation.create({ confirmed: false, groupId: 'group-1', name: 'Groceries' }))
      .rejects.toMatchObject({ code: 'CATEGORY_CREATION_NOT_CONFIRMED' });
    expect(actualBudget.createCategory).not.toHaveBeenCalled();

    await expect(creation.create({ confirmed: true, groupId: ' group-1 ', name: ' Groceries ' }))
      .resolves.toEqual({ id: 'category-1', name: 'Groceries' });
    expect(actualBudget.createCategory).toHaveBeenCalledWith('group-1', 'Groceries');
  });

  it('requires a category group and name', async () => {
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory: vi.fn(), updateCategory: vi.fn(), updateCategoryGroup: vi.fn() });

    await expect(creation.create({ confirmed: true, groupId: ' ', name: 'Groceries' }))
      .rejects.toEqual(new CategoryCreationError('INVALID_CATEGORY_GROUP'));
    await expect(creation.create({ confirmed: true, groupId: 'group-1', name: ' ' }))
      .rejects.toEqual(new CategoryCreationError('INVALID_CATEGORY_NAME'));
  });

  it('creates a category group only after confirmation', async () => {
    const actualBudget = {
      createCategory: vi.fn(),
      createCategoryGroup: vi.fn().mockResolvedValue({ id: 'group-1', name: 'Everyday' }),
      deleteCategory: vi.fn(),
      updateCategory: vi.fn(),
      updateCategoryGroup: vi.fn(),
    };
    const creation = new CategoryCreation(actualBudget);

    await expect(creation.createGroup({ confirmed: false, name: 'Everyday' }))
      .rejects.toMatchObject({ code: 'CATEGORY_GROUP_CREATION_NOT_CONFIRMED' });
    expect(actualBudget.createCategoryGroup).not.toHaveBeenCalled();

    await expect(creation.createGroup({ confirmed: true, name: ' Everyday ' }))
      .resolves.toEqual({ id: 'group-1', name: 'Everyday' });
    expect(actualBudget.createCategoryGroup).toHaveBeenCalledWith('Everyday');
  });

  it('requires a category group name', async () => {
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory: vi.fn(), updateCategory: vi.fn(), updateCategoryGroup: vi.fn() });
    await expect(creation.createGroup({ confirmed: true, name: ' ' }))
      .rejects.toEqual(new CategoryCreationError('INVALID_CATEGORY_GROUP_NAME'));
  });

  it('renames a category after validating its ID and name', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ id: 'category-1', name: 'Food' });
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory: vi.fn(), updateCategory, updateCategoryGroup: vi.fn() });

    await expect(creation.update({ id: ' category-1 ', name: ' Food ' }))
      .resolves.toEqual({ id: 'category-1', name: 'Food' });
    expect(updateCategory).toHaveBeenCalledWith('category-1', 'Food');
    await expect(creation.update({ id: '', name: 'Food' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY_ID' });
    await expect(creation.update({ id: 'category-1', name: ' ' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY_NAME' });
  });

  it('moves a category to another group and renames a group', async () => {
    const updateCategory = vi.fn().mockResolvedValue({ id: 'category-1', name: 'Food' });
    const updateCategoryGroup = vi.fn().mockResolvedValue({ id: 'group-2', name: 'Everyday' });
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory: vi.fn(), updateCategory, updateCategoryGroup });

    await creation.update({ groupId: ' group-2 ', id: 'category-1', name: 'Food' });
    expect(updateCategory).toHaveBeenCalledWith('category-1', 'Food', 'group-2');
    await expect(creation.update({ groupId: ' ', id: 'category-1', name: 'Food' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY_GROUP' });

    await expect(creation.updateGroup({ id: ' group-2 ', name: ' Everyday ' })).resolves.toEqual({ id: 'group-2', name: 'Everyday' });
    expect(updateCategoryGroup).toHaveBeenCalledWith('group-2', 'Everyday');
    await expect(creation.updateGroup({ id: 'group-2', name: ' ' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY_GROUP_NAME' });
    await expect(creation.updateGroup({ id: ' ', name: 'Everyday' })).rejects.toMatchObject({ code: 'INVALID_CATEGORY_GROUP' });
  });

  it('merges a removed category into a different transfer category', async () => {
    const deleteCategory = vi.fn();
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory, updateCategory: vi.fn(), updateCategoryGroup: vi.fn() });

    await creation.delete({ confirmed: true, id: 'category-1', transferCategoryId: ' category-2 ' });
    expect(deleteCategory).toHaveBeenCalledWith('category-1', 'category-2');
    await expect(creation.delete({ confirmed: true, id: 'category-1', transferCategoryId: 'category-1' }))
      .rejects.toMatchObject({ code: 'INVALID_TRANSFER_CATEGORY' });
    expect(deleteCategory).toHaveBeenCalledTimes(1);
  });

  it('removes a category only after confirmation', async () => {
    const deleteCategory = vi.fn();
    const creation = new CategoryCreation({ createCategory: vi.fn(), createCategoryGroup: vi.fn(), deleteCategory, updateCategory: vi.fn(), updateCategoryGroup: vi.fn() });

    await expect(creation.delete({ confirmed: false, id: 'category-1' }))
      .rejects.toMatchObject({ code: 'CATEGORY_DELETION_NOT_CONFIRMED' });
    expect(deleteCategory).not.toHaveBeenCalled();
    await creation.delete({ confirmed: true, id: ' category-1 ' });
    expect(deleteCategory).toHaveBeenCalledWith('category-1');
  });
});

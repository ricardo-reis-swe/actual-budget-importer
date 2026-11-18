export interface ActualCategory {
  id: string;
  name: string;
}

export interface ActualCategoryGroup {
  id: string;
  name: string;
}

export interface ActualCategoryCreator {
  createCategory(groupId: string, name: string): Promise<ActualCategory>;
  createCategoryGroup(name: string): Promise<ActualCategoryGroup>;
  deleteCategory(id: string, transferCategoryId?: string): Promise<void>;
  updateCategory(id: string, name: string, groupId?: string): Promise<ActualCategory>;
  updateCategoryGroup(id: string, name: string): Promise<ActualCategoryGroup>;
}

export class CategoryCreationError extends Error {
  constructor(readonly code: 'CATEGORY_CREATION_NOT_CONFIRMED' | 'CATEGORY_DELETION_NOT_CONFIRMED' | 'CATEGORY_GROUP_CREATION_NOT_CONFIRMED' | 'INVALID_CATEGORY_ID' | 'INVALID_CATEGORY_GROUP' | 'INVALID_TRANSFER_CATEGORY' | 'INVALID_CATEGORY_NAME' | 'INVALID_CATEGORY_GROUP_NAME') {
    super(code);
  }
}

export class CategoryCreation {
  constructor(private readonly actualBudget: ActualCategoryCreator) {}

  async create(input: { confirmed: boolean; groupId: string; name: string }): Promise<ActualCategory> {
    if (!input.confirmed) {
      throw new CategoryCreationError('CATEGORY_CREATION_NOT_CONFIRMED');
    }

    const groupId = input.groupId.trim();
    if (!groupId) {
      throw new CategoryCreationError('INVALID_CATEGORY_GROUP');
    }

    const name = input.name.trim();
    if (!name) {
      throw new CategoryCreationError('INVALID_CATEGORY_NAME');
    }

    return this.actualBudget.createCategory(groupId, name);
  }

  async createGroup(input: { confirmed: boolean; name: string }): Promise<ActualCategoryGroup> {
    if (!input.confirmed) {
      throw new CategoryCreationError('CATEGORY_GROUP_CREATION_NOT_CONFIRMED');
    }

    const name = input.name.trim();
    if (!name) {
      throw new CategoryCreationError('INVALID_CATEGORY_GROUP_NAME');
    }

    return this.actualBudget.createCategoryGroup(name);
  }

  async update(input: { groupId?: string; id: string; name: string }): Promise<ActualCategory> {
    const id = input.id.trim();
    if (!id) {
      throw new CategoryCreationError('INVALID_CATEGORY_ID');
    }

    const name = input.name.trim();
    if (!name) {
      throw new CategoryCreationError('INVALID_CATEGORY_NAME');
    }

    if (input.groupId === undefined) {
      return this.actualBudget.updateCategory(id, name);
    }
    const groupId = input.groupId.trim();
    if (!groupId) {
      throw new CategoryCreationError('INVALID_CATEGORY_GROUP');
    }
    return this.actualBudget.updateCategory(id, name, groupId);
  }

  async updateGroup(input: { id: string; name: string }): Promise<ActualCategoryGroup> {
    const id = input.id.trim();
    if (!id) {
      throw new CategoryCreationError('INVALID_CATEGORY_GROUP');
    }

    const name = input.name.trim();
    if (!name) {
      throw new CategoryCreationError('INVALID_CATEGORY_GROUP_NAME');
    }

    return this.actualBudget.updateCategoryGroup(id, name);
  }

  async delete(input: { confirmed: boolean; id: string; transferCategoryId?: string }): Promise<void> {
    if (!input.confirmed) {
      throw new CategoryCreationError('CATEGORY_DELETION_NOT_CONFIRMED');
    }

    const id = input.id.trim();
    if (!id) {
      throw new CategoryCreationError('INVALID_CATEGORY_ID');
    }

    if (input.transferCategoryId === undefined) {
      await this.actualBudget.deleteCategory(id);
      return;
    }
    const transferCategoryId = input.transferCategoryId.trim();
    if (!transferCategoryId || transferCategoryId === id) {
      throw new CategoryCreationError('INVALID_TRANSFER_CATEGORY');
    }
    await this.actualBudget.deleteCategory(id, transferCategoryId);
  }
}

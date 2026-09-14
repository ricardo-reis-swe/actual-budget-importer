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
  deleteCategory(id: string): Promise<void>;
  updateCategory(id: string, name: string): Promise<ActualCategory>;
}

export class CategoryCreationError extends Error {
  constructor(readonly code: 'CATEGORY_CREATION_NOT_CONFIRMED' | 'CATEGORY_DELETION_NOT_CONFIRMED' | 'CATEGORY_GROUP_CREATION_NOT_CONFIRMED' | 'INVALID_CATEGORY_ID' | 'INVALID_CATEGORY_GROUP' | 'INVALID_CATEGORY_NAME' | 'INVALID_CATEGORY_GROUP_NAME') {
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

  async update(input: { id: string; name: string }): Promise<ActualCategory> {
    const id = input.id.trim();
    if (!id) {
      throw new CategoryCreationError('INVALID_CATEGORY_ID');
    }

    const name = input.name.trim();
    if (!name) {
      throw new CategoryCreationError('INVALID_CATEGORY_NAME');
    }

    return this.actualBudget.updateCategory(id, name);
  }

  async delete(input: { confirmed: boolean; id: string }): Promise<void> {
    if (!input.confirmed) {
      throw new CategoryCreationError('CATEGORY_DELETION_NOT_CONFIRMED');
    }

    const id = input.id.trim();
    if (!id) {
      throw new CategoryCreationError('INVALID_CATEGORY_ID');
    }

    await this.actualBudget.deleteCategory(id);
  }
}

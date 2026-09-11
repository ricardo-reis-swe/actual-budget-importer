export interface ActualCategory {
  id: string;
  name: string;
}

export interface ActualCategoryCreator {
  createCategory(groupId: string, name: string): Promise<ActualCategory>;
}

export class CategoryCreationError extends Error {
  constructor(readonly code: 'CATEGORY_CREATION_NOT_CONFIRMED' | 'INVALID_CATEGORY_GROUP' | 'INVALID_CATEGORY_NAME') {
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
}

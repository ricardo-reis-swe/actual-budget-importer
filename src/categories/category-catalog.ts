import { type Kysely } from 'kysely';

import { type DatabaseSchema } from '../storage/migrations.js';

export interface ActualCategory {
  id: string;
  name: string;
  groupId: string;
  hidden: boolean;
  deleted: boolean;
}

export interface ActualCategoryGroup {
  id: string;
  name: string;
  deleted: boolean;
  categories: ActualCategory[];
}

export interface ActualCategorySource {
  getCategoriesGrouped(): Promise<readonly {
    id: string;
    name: string;
    categories: readonly { id: string; name: string; hidden?: boolean }[];
  }[]>;
}

export class CategoryCatalog {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async refresh(source: ActualCategorySource): Promise<ActualCategoryGroup[]> {
    const remoteGroups = await source.getCategoriesGrouped();
    await this.database.transaction().execute(async (transaction) => {
      const remoteGroupIds = remoteGroups.map((group) => group.id);
      await transaction.updateTable('actual_category_groups').set({ deleted: 1 }).execute();
      await transaction.updateTable('actual_categories').set({ deleted: 1 }).execute();
      for (const group of remoteGroups) {
        await transaction.insertInto('actual_category_groups').values({ id: group.id, name: group.name, deleted: 0 })
          .onConflict((conflict) => conflict.column('id').doUpdateSet({ name: group.name, deleted: 0 })).execute();
        for (const category of group.categories) {
          await transaction.insertInto('actual_categories').values({
            id: category.id,
            group_id: group.id,
            name: category.name,
            hidden: category.hidden ? 1 : 0,
            deleted: 0,
          }).onConflict((conflict) => conflict.column('id').doUpdateSet({
            group_id: group.id,
            name: category.name,
            hidden: category.hidden ? 1 : 0,
            deleted: 0,
          })).execute();
        }
      }
      if (remoteGroupIds.length > 0) {
        await transaction.updateTable('actual_category_groups').set({ deleted: 1 })
          .where('id', 'not in', remoteGroupIds).execute();
      }
    });
    return this.list();
  }

  async list(): Promise<ActualCategoryGroup[]> {
    const rows = await this.database.selectFrom('actual_categories')
      .innerJoin('actual_category_groups', 'actual_category_groups.id', 'actual_categories.group_id')
      .select([
        'actual_category_groups.id as group_id',
        'actual_category_groups.name as group_name',
        'actual_category_groups.deleted as group_deleted',
        'actual_categories.id',
        'actual_categories.name',
        'actual_categories.hidden',
        'actual_categories.deleted',
      ]).orderBy('actual_category_groups.name').orderBy('actual_categories.name').execute();
    const used = new Set((await this.database.selectFrom('statement_transactions').select('actual_category_id').where('actual_category_id', 'is not', null).execute())
      .map((row) => row.actual_category_id));
    const groups = new Map<string, ActualCategoryGroup>();
    for (const row of rows) {
      if (row.deleted === 1 && !used.has(row.id)) continue;
      const group = groups.get(row.group_id) ?? { id: row.group_id, name: row.group_name, deleted: row.group_deleted === 1, categories: [] };
      group.categories.push({ id: row.id, name: row.name, groupId: row.group_id, hidden: row.hidden === 1, deleted: row.deleted === 1 });
      groups.set(row.group_id, group);
    }
    return [...groups.values()];
  }
}

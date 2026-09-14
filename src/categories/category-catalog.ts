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
      for (const [groupPosition, group] of remoteGroups.entries()) {
        await transaction.insertInto('actual_category_groups').values({ id: group.id, name: group.name, deleted: 0, position: groupPosition })
          .onConflict((conflict) => conflict.column('id').doUpdateSet({ name: group.name, deleted: 0, position: groupPosition })).execute();
        for (const [categoryPosition, category] of group.categories.entries()) {
          await transaction.insertInto('actual_categories').values({
            id: category.id,
            group_id: group.id,
            name: category.name,
            hidden: category.hidden ? 1 : 0,
            deleted: 0,
            position: categoryPosition,
          }).onConflict((conflict) => conflict.column('id').doUpdateSet({
            group_id: group.id,
            name: category.name,
            hidden: category.hidden ? 1 : 0,
            deleted: 0,
            position: categoryPosition,
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
    const groupRows = await this.database.selectFrom('actual_category_groups')
      .selectAll().orderBy('position').orderBy('name').execute();
    const categoryRows = await this.database.selectFrom('actual_categories')
      .selectAll().orderBy('group_id').orderBy('position').orderBy('name').execute();
    const used = new Set((await this.database.selectFrom('statement_transactions').select('actual_category_id').where('actual_category_id', 'is not', null).execute())
      .map((row) => row.actual_category_id));
    const groups = new Map<string, ActualCategoryGroup>();
    for (const row of groupRows) {
      if (row.deleted === 0) {
        groups.set(row.id, { id: row.id, name: row.name, deleted: false, categories: [] });
      }
    }
    for (const row of categoryRows) {
      if (row.deleted === 1 && !used.has(row.id)) continue;
      const groupRow = groupRows.find((group) => group.id === row.group_id);
      if (!groupRow) continue;
      const group = groups.get(row.group_id) ?? { id: groupRow.id, name: groupRow.name, deleted: groupRow.deleted === 1, categories: [] };
      group.categories.push({ id: row.id, name: row.name, groupId: row.group_id, hidden: row.hidden === 1, deleted: row.deleted === 1 });
      groups.set(group.id, group);
    }
    return [...groups.values()];
  }
}

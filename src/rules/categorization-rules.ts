import { type Kysely } from 'kysely';

import { type DatabaseSchema } from '../storage/migrations.js';

export interface CategorizationRule {
  categoryId: string;
  createdAt: string;
  descriptionContains: string;
  id: number;
  parserId: string | null;
  position: number;
}

export interface CategorizationRuleMatcher {
  match(description: string, parserId?: string | null): Promise<string | null>;
}

export class CategorizationRuleError extends Error {
  constructor(readonly code: 'INVALID_CATEGORY' | 'INVALID_MATCH_TEXT' | 'INVALID_RULE_ORDER' | 'RULE_NOT_FOUND') {
    super(code);
  }
}

/** Persists the user-controlled matching order used for transaction categorization. */
export class CategorizationRules implements CategorizationRuleMatcher {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<CategorizationRule[]> {
    const rules = await this.database
      .selectFrom('categorization_rules')
      .selectAll()
      .orderBy('position')
      .orderBy('id')
      .execute();
    return rules.map(toRule);
  }

  async create(input: { categoryId: string; descriptionContains: string; parserId?: string | null }): Promise<CategorizationRule> {
    const categoryId = requireCategory(input.categoryId);
    const descriptionContains = requireMatchText(input.descriptionContains);
    const lastRule = await this.database
      .selectFrom('categorization_rules')
      .select('position')
      .orderBy('position', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const rule = await this.database
      .insertInto('categorization_rules')
      .values({
        category_id: categoryId,
        created_at: this.now().toISOString(),
        description_contains: descriptionContains,
        parser_id: normalizeParser(input.parserId),
        position: (lastRule?.position ?? -1) + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRule(rule);
  }

  async update(ruleId: number, input: { categoryId: string; descriptionContains: string; parserId?: string | null }): Promise<CategorizationRule> {
    const categoryId = requireCategory(input.categoryId);
    const descriptionContains = requireMatchText(input.descriptionContains);
    const rule = await this.database
      .updateTable('categorization_rules')
      .set({ category_id: categoryId, description_contains: descriptionContains, parser_id: normalizeParser(input.parserId) })
      .where('id', '=', ruleId)
      .returningAll()
      .executeTakeFirst();
    if (!rule) throw new CategorizationRuleError('RULE_NOT_FOUND');
    return toRule(rule);
  }

  async delete(ruleId: number): Promise<void> {
    const deleted = await this.database
      .deleteFrom('categorization_rules')
      .where('id', '=', ruleId)
      .executeTakeFirst();
    if (Number(deleted.numDeletedRows) !== 1) throw new CategorizationRuleError('RULE_NOT_FOUND');
  }

  async reorder(ruleIds: readonly number[]): Promise<void> {
    const rules = await this.list();
    if (ruleIds.length !== rules.length || new Set(ruleIds).size !== ruleIds.length
      || !ruleIds.every((id) => rules.some((rule) => rule.id === id))) {
      throw new CategorizationRuleError('INVALID_RULE_ORDER');
    }
    await this.database.transaction().execute(async (transaction) => {
      for (const [position, id] of ruleIds.entries()) {
        await transaction.updateTable('categorization_rules').set({ position }).where('id', '=', id).execute();
      }
    });
  }

  async match(description: string, parserId?: string | null): Promise<string | null> {
    const normalizedDescription = description.toLowerCase();
    for (const rule of await this.list()) {
      if ((rule.parserId === null || rule.parserId === parserId)
        && normalizedDescription.includes(rule.descriptionContains.toLowerCase())) {
        return rule.categoryId;
      }
    }
    return null;
  }
}

function normalizeParser(parserId: string | null | undefined): string | null {
  const normalized = parserId?.trim();
  return normalized || null;
}

function requireCategory(categoryId: string): string {
  const normalized = categoryId.trim();
  if (!normalized) throw new CategorizationRuleError('INVALID_CATEGORY');
  return normalized;
}

function requireMatchText(descriptionContains: string): string {
  const normalized = descriptionContains.trim();
  if (!normalized) throw new CategorizationRuleError('INVALID_MATCH_TEXT');
  return normalized;
}

function toRule(rule: {
  category_id: string;
  created_at: string;
  description_contains: string;
  id: number;
  parser_id: string | null;
  position: number;
}): CategorizationRule {
  return {
    categoryId: rule.category_id,
    createdAt: rule.created_at,
    descriptionContains: rule.description_contains,
    id: rule.id,
    parserId: rule.parser_id,
    position: rule.position,
  };
}

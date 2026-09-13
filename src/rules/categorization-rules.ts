import { type Kysely } from 'kysely';

import { type DatabaseSchema } from '../storage/migrations.js';

export interface CategorizationRule {
  categoryId: string | null;
  createdAt: string;
  descriptionContains: string;
  excluded: boolean | null;
  id: number;
  parserId: string | null;
  position: number;
}

export interface CategorizationRuleMatcher {
  match(description: string, parserId?: string | null): Promise<RuleMatch | null>;
}

export interface RuleMatch {
  categoryId: string | null;
  excluded: boolean | null;
}

export class CategorizationRuleError extends Error {
  constructor(readonly code: 'INVALID_CATEGORY' | 'INVALID_INCLUSION_ACTION' | 'INVALID_MATCH_TEXT' | 'INVALID_RULE_ACTION' | 'INVALID_RULE_ORDER' | 'RULE_NOT_FOUND') {
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

  async create(input: RuleInput): Promise<CategorizationRule> {
    const action = requireAction(input);
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
        category_enabled: action.categoryId === null ? 0 : 1,
        category_id: action.categoryId ?? '',
        created_at: this.now().toISOString(),
        description_contains: descriptionContains,
        inclusion_action: action.inclusionAction,
        parser_id: normalizeParser(input.parserId),
        position: (lastRule?.position ?? -1) + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRule(rule);
  }

  async update(ruleId: number, input: RuleInput): Promise<CategorizationRule> {
    const action = requireAction(input);
    const descriptionContains = requireMatchText(input.descriptionContains);
    const rule = await this.database
      .updateTable('categorization_rules')
      .set({
        category_enabled: action.categoryId === null ? 0 : 1,
        category_id: action.categoryId ?? '',
        description_contains: descriptionContains,
        inclusion_action: action.inclusionAction,
        parser_id: normalizeParser(input.parserId),
      })
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

  async match(description: string, parserId?: string | null): Promise<RuleMatch | null> {
    const normalizedDescription = description.toLowerCase();
    for (const rule of await this.list()) {
      if ((rule.parserId === null || rule.parserId === parserId)
        && normalizedDescription.includes(rule.descriptionContains.toLowerCase())) {
        return { categoryId: rule.categoryId, excluded: rule.excluded };
      }
    }
    return null;
  }
}

function normalizeParser(parserId: string | null | undefined): string | null {
  const normalized = parserId?.trim();
  return normalized || null;
}

interface RuleInput {
  categoryId?: string | null;
  descriptionContains: string;
  excluded?: boolean | null;
  parserId?: string | null;
}

function requireAction(input: RuleInput): { categoryId: string | null; inclusionAction: string | null } {
  if (input.excluded !== undefined && input.excluded !== null && typeof input.excluded !== 'boolean') {
    throw new CategorizationRuleError('INVALID_INCLUSION_ACTION');
  }
  const normalizedCategory = input.categoryId?.trim();
  if (input.categoryId !== undefined && input.categoryId !== null && !normalizedCategory) {
    throw new CategorizationRuleError('INVALID_CATEGORY');
  }
  const categoryId = normalizedCategory || null;
  const inclusionAction = input.excluded === true ? 'exclude' : input.excluded === false ? 'include' : null;
  if (categoryId === null && inclusionAction === null) throw new CategorizationRuleError('INVALID_RULE_ACTION');
  return { categoryId, inclusionAction };
}

function requireMatchText(descriptionContains: string): string {
  const normalized = descriptionContains.trim();
  if (!normalized) throw new CategorizationRuleError('INVALID_MATCH_TEXT');
  return normalized;
}

function toRule(rule: {
  category_id: string;
  category_enabled: number;
  created_at: string;
  description_contains: string;
  id: number;
  inclusion_action: string | null;
  parser_id: string | null;
  position: number;
}): CategorizationRule {
  return {
    categoryId: rule.category_enabled === 1 ? rule.category_id : null,
    createdAt: rule.created_at,
    descriptionContains: rule.description_contains,
    excluded: rule.inclusion_action === 'exclude' ? true : rule.inclusion_action === 'include' ? false : null,
    id: rule.id,
    parserId: rule.parser_id,
    position: rule.position,
  };
}

import type { Kysely } from 'kysely';

import type { DatabaseSchema } from '../storage/migrations.js';
import type { BankParser } from './bank-parser.js';

export interface ParserSetting {
  enabled: boolean;
  id: string;
  name: string;
}

export interface CorrespondentParserMapping {
  correspondentId: number;
  correspondentName: string | null;
  parserId: string | null;
}

export class ParserSettingsError extends Error {
  constructor(readonly code: 'INVALID_CORRESPONDENT' | 'INVALID_PARSER') {
    super(code);
  }
}

export class ParserSettings {
  private readonly parsers: ReadonlyMap<string, Pick<BankParser, 'id' | 'name'>>;

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    parsers: readonly Pick<BankParser, 'id' | 'name'>[],
    private readonly paperless?: { getCorrespondentName(correspondentId: number): Promise<string> },
  ) {
    this.parsers = new Map(parsers.map((parser) => [parser.id, parser]));
  }

  async listParsers(includeDisabled = false): Promise<ParserSetting[]> {
    const saved = await this.database
      .selectFrom('parser_settings')
      .selectAll()
      .execute();
    const enabledById = new Map(saved.map((setting) => [setting.parser_id, setting.enabled === 1]));
    return [...this.parsers.values()]
      .map((parser) => ({ ...parser, enabled: enabledById.get(parser.id) ?? true }))
      .filter((parser) => includeDisabled || parser.enabled);
  }

  async setParserEnabled(parserId: string, enabled: boolean): Promise<void> {
    this.requireParser(parserId);
    await this.database
      .insertInto('parser_settings')
      .values({ parser_id: parserId, enabled: enabled ? 1 : 0 })
      .onConflict((conflict) => conflict.column('parser_id').doUpdateSet({ enabled: enabled ? 1 : 0 }))
      .execute();
  }

  async listCorrespondents(): Promise<CorrespondentParserMapping[]> {
    const statements = await this.database
      .selectFrom('statements')
      .select(['paperless_correspondent_id', 'paperless_correspondent_name'])
      .where('paperless_correspondent_id', 'is not', null)
      .orderBy('paperless_correspondent_name')
      .execute();
    const mappings = await this.database
      .selectFrom('paperless_parser_mappings')
      .selectAll()
      .execute();
    const parserByCorrespondent = new Map(mappings.map((mapping) => [mapping.correspondent_id, mapping.parser_id]));
    const names = new Map<number, string | null>();
    for (const statement of statements) {
      const id = statement.paperless_correspondent_id!;
      if (!names.has(id) || statement.paperless_correspondent_name) {
        names.set(id, statement.paperless_correspondent_name);
      }
    }
    for (const mapping of mappings) {
      if (!names.has(mapping.correspondent_id)) names.set(mapping.correspondent_id, null);
    }
    if (this.paperless) {
      await Promise.all([...names.entries()].map(async ([correspondentId, correspondentName]) => {
        if (correspondentName !== null) return;
        try {
          const resolvedName = await this.paperless!.getCorrespondentName(correspondentId);
          names.set(correspondentId, resolvedName);
          await this.database.updateTable('statements')
            .set({ paperless_correspondent_name: resolvedName })
            .where('paperless_correspondent_id', '=', correspondentId)
            .execute();
        } catch {
          // Keep settings usable if Paperless is temporarily unavailable.
        }
      }));
    }
    return [...names.entries()]
      .map(([correspondentId, correspondentName]) => ({
        correspondentId,
        correspondentName,
        parserId: parserByCorrespondent.get(correspondentId) ?? null,
      }))
      .sort((left, right) => (left.correspondentName ?? '').localeCompare(right.correspondentName ?? '') || left.correspondentId - right.correspondentId);
  }

  async setCorrespondentParser(correspondentId: number, parserId: string | null): Promise<void> {
    if (!Number.isSafeInteger(correspondentId) || correspondentId < 1) {
      throw new ParserSettingsError('INVALID_CORRESPONDENT');
    }
    if (parserId === null) {
      await this.database.deleteFrom('paperless_parser_mappings').where('correspondent_id', '=', correspondentId).execute();
      return;
    }
    this.requireParser(parserId);
    await this.database
      .insertInto('paperless_parser_mappings')
      .values({ correspondent_id: correspondentId, parser_id: parserId })
      .onConflict((conflict) => conflict.column('correspondent_id').doUpdateSet({ parser_id: parserId }))
      .execute();
  }

  private requireParser(parserId: string): void {
    if (!this.parsers.has(parserId)) throw new ParserSettingsError('INVALID_PARSER');
  }
}

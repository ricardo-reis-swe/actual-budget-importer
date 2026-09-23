import { GroupedSelect, type GroupedSelectGroup } from './grouped-select.js';

export interface ParserSelectOption {
  countryCode: string;
  countryName: string;
  enabled?: boolean;
  id: string;
  name: string;
}

export function groupParserOptions(
  parsers: readonly ParserSelectOption[],
  optionLabel: (parser: ParserSelectOption) => string = defaultParserLabel,
): GroupedSelectGroup[] {
  const countries = new Map<string, { id: string; label: string; parsers: ParserSelectOption[] }>();
  for (const parser of parsers) {
    const country = countries.get(parser.countryCode) ?? {
      id: parser.countryCode,
      label: parser.countryName,
      parsers: [],
    };
    country.parsers.push(parser);
    countries.set(parser.countryCode, country);
  }
  return [...countries.values()]
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((country) => ({
      id: country.id,
      label: country.label,
      options: country.parsers
        .toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .map((parser) => ({ id: parser.id, label: optionLabel(parser) })),
    }));
}

export function GroupedParserSelect({
  ariaLabel,
  disabled = false,
  emptyLabel,
  id,
  onChange,
  optionLabel = defaultParserLabel,
  parsers,
  value,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel: string;
  id?: string;
  onChange(value: string): void;
  optionLabel?: (parser: ParserSelectOption) => string;
  parsers: readonly ParserSelectOption[];
  value: string;
}) {
  const groups = groupParserOptions(parsers, optionLabel);
  return <GroupedSelect
    {...(ariaLabel === undefined ? {} : { ariaLabel })}
    disabled={disabled}
    emptyLabel={emptyLabel}
    groups={groups}
    {...(id === undefined ? {} : { id })}
    onChange={onChange}
    showGroupLabels={groups.length > 1}
    value={value}
  />;
}

function defaultParserLabel(parser: ParserSelectOption): string {
  return `${parser.name}${parser.enabled === false ? ' (hidden)' : ''}`;
}

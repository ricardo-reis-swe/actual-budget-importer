import type { ReactNode } from 'react';

import { GroupedSelect } from './grouped-select.js';

export interface CategoryOption {
  deleted: boolean;
  hidden?: boolean;
  id: string;
  name: string;
}

export interface CategoryOptionGroup {
  categories: CategoryOption[];
  deleted?: boolean;
  id: string;
  name: string;
}

export function findCategoryPath(groups: CategoryOptionGroup[], categoryId: string) {
  for (const group of groups) {
    const category = group.categories.find((item) => item.id === categoryId);
    if (category) return { category, group };
  }
  return undefined;
}

export function CategoryPathLabel({ categoryId, groups }: { categoryId: string; groups: CategoryOptionGroup[] }): ReactNode {
  const path = findCategoryPath(groups, categoryId);
  if (!path) return <>{categoryId} (deleted)</>;
  return <><strong>{path.group.name}</strong><span aria-hidden="true">/</span>{path.category.name}{path.category.deleted ? ' (deleted)' : ''}</>;
}

export function GroupedCategorySelect({
  ariaLabel,
  disabled = false,
  emptyLabel,
  groups,
  id,
  onChange,
  value,
  fillRemainingViewport = false,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel: string;
  groups: CategoryOptionGroup[];
  id?: string;
  onChange: (value: string) => void;
  value: string;
  fillRemainingViewport?: boolean;
}) {
  const selected = findCategoryPath(groups, value);
  const activeGroups = groups
    .filter((group) => !group.deleted && group.categories.some((category) => !category.deleted))
    .map((group) => ({
      id: group.id,
      label: group.name,
      options: group.categories
        .filter((category) => !category.deleted)
        .map((category) => ({
          ariaLabel: `${group.name}/${category.name}${category.hidden ? ' (hidden)' : ''}`,
          id: category.id,
          label: `${category.name}${category.hidden ? ' (hidden)' : ''}`,
        })),
    }));

  return <GroupedSelect
    {...(ariaLabel === undefined ? {} : { ariaLabel })}
    disabled={disabled}
    emptyLabel={emptyLabel}
    fillRemainingViewport={fillRemainingViewport}
    groups={activeGroups}
    {...(id === undefined ? {} : { id })}
    onChange={onChange}
    {...(selected ? { selectedLabel: <CategoryPathLabel categoryId={value} groups={groups} /> } : {})}
    value={value}
  />;
}

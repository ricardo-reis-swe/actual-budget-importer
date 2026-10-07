export function isCategoryAvailable(
  groups: readonly { deleted?: boolean; categories: readonly { id: string; deleted: boolean }[] }[],
  categoryId: string | null,
): boolean {
  return !categoryId || groups.some((group) => !group.deleted
    && group.categories.some((category) => category.id === categoryId && !category.deleted));
}

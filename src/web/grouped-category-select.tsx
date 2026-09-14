import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';

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
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ height?: number; left: number; top: number; width: number }>({ left: 0, top: 0, width: 240 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  const toggle = () => {
    if (!open && trigger.current) {
      const bounds = trigger.current.getBoundingClientRect();
      const top = bounds.bottom + 4;
      setMenuPosition({
        ...(fillRemainingViewport ? { height: Math.max(0, window.innerHeight - top - 8) } : {}),
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - Math.max(bounds.width, 240) - 8)),
        top,
        width: Math.max(bounds.width, 240),
      });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    };
    const closeOnOutsideScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', closeOnOutsideScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
    };
  }, [open]);

  const choose = (categoryId: string) => {
    onChange(categoryId);
    close();
    trigger.current?.focus();
  };

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options[next]?.focus();
  };

  return <span className="category-picker">
    <button ref={trigger} type="button" className="grouped-category-select" aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} disabled={disabled} id={id} onClick={toggle} onKeyDown={(event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (!open) toggle();
      requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus());
    }}>
      <span>{selected ? <CategoryPathLabel categoryId={value} groups={groups} /> : emptyLabel}</span><span className="category-picker-arrow" aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div ref={menu} className={`category-picker-menu${fillRemainingViewport ? ' category-picker-menu-remaining-viewport' : ''}`} role="listbox" aria-label={ariaLabel ?? 'Category'} style={menuPosition} onKeyDown={navigateMenu}>
      <button type="button" role="option" aria-selected={!value} onClick={() => choose('')}>{emptyLabel}</button>
      {groups.filter((group) => !group.deleted && group.categories.some((category) => !category.deleted)).map((group) => <div className="category-picker-group" role="group" aria-label={group.name} key={group.id}>
        <div className="category-picker-group-heading" aria-hidden="true">{group.name}</div>
        {group.categories.filter((category) => !category.deleted).map((category) => <button type="button" role="option" aria-label={`${group.name}/${category.name}${category.hidden ? ' (hidden)' : ''}`} aria-selected={category.id === value} key={category.id} onClick={() => choose(category.id)}>{category.name}{category.hidden ? ' (hidden)' : ''}</button>)}
      </div>)}
    </div>, document.body)}
  </span>;
}

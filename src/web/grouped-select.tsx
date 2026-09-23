import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';

const MENU_MIN_HEIGHT = 192;
const MENU_VIEWPORT_MARGIN = 8;

export interface GroupedSelectOption {
  ariaLabel?: string;
  id: string;
  label: string;
}

export interface GroupedSelectGroup {
  id: string;
  label: string;
  options: readonly GroupedSelectOption[];
}

export function findGroupedOption(groups: readonly GroupedSelectGroup[], value: string) {
  for (const group of groups) {
    const option = group.options.find((candidate) => candidate.id === value);
    if (option) return { group, option };
  }
  return undefined;
}

export function GroupedSelect({
  ariaLabel,
  disabled = false,
  emptyLabel,
  fillRemainingViewport = false,
  groups,
  id,
  onChange,
  selectedLabel,
  showGroupLabels = true,
  value,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  emptyLabel: string;
  fillRemainingViewport?: boolean;
  groups: readonly GroupedSelectGroup[];
  id?: string;
  onChange(value: string): void;
  selectedLabel?: ReactNode;
  showGroupLabels?: boolean;
  value: string;
}) {
  const selected = findGroupedOption(groups, value);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ height?: number; left: number; top: number; width: number }>({ left: 0, top: 0, width: 240 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  const toggle = () => {
    if (!open && trigger.current) {
      const bounds = trigger.current.getBoundingClientRect();
      const preferredTop = bounds.bottom + 4;
      const maximumHeight = Math.max(0, window.innerHeight - (MENU_VIEWPORT_MARGIN * 2));
      const minimumHeight = Math.min(MENU_MIN_HEIGHT, maximumHeight);
      const remainingHeight = Math.max(0, window.innerHeight - preferredTop - MENU_VIEWPORT_MARGIN);
      const height = Math.max(minimumHeight, remainingHeight);
      const top = fillRemainingViewport
        ? Math.max(MENU_VIEWPORT_MARGIN, Math.min(preferredTop, window.innerHeight - height - MENU_VIEWPORT_MARGIN))
        : preferredTop;
      setMenuPosition({
        ...(fillRemainingViewport ? { height } : {}),
        left: Math.max(MENU_VIEWPORT_MARGIN, Math.min(bounds.left, window.innerWidth - Math.max(bounds.width, 240) - MENU_VIEWPORT_MARGIN)),
        top,
        width: Math.max(bounds.width, 240),
      });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      menu.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    });
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
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
    };
  }, [open, value]);

  const choose = (optionId: string) => {
    onChange(optionId);
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

  const defaultSelectedLabel = selected
    ? showGroupLabels
      ? <><strong>{selected.group.label}</strong><span aria-hidden="true">/</span>{selected.option.label}</>
      : selected.option.label
    : emptyLabel;

  return <span className="category-picker">
    <button ref={trigger} type="button" className="grouped-category-select" aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} disabled={disabled} id={id} onClick={toggle} onKeyDown={(event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (!open) toggle();
      requestAnimationFrame(() => {
        const selectedOption = menu.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
        (selectedOption ?? menu.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
      });
    }}>
      <span>{selectedLabel ?? defaultSelectedLabel}</span><span className="category-picker-arrow" aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div ref={menu} className={`category-picker-menu${fillRemainingViewport ? ' category-picker-menu-remaining-viewport' : ''}`} role="listbox" aria-label={ariaLabel ?? 'Options'} style={menuPosition} onKeyDown={navigateMenu}>
      <button type="button" role="option" aria-selected={!value} onClick={() => choose('')}>{emptyLabel}</button>
      {groups.map((group) => <div className="category-picker-group" role="group" aria-label={group.label} key={group.id}>
        {showGroupLabels && <div className="category-picker-group-heading" aria-hidden="true">{group.label}</div>}
        {group.options.map((option) => <button type="button" role="option" aria-label={option.ariaLabel ?? (showGroupLabels ? `${group.label}/${option.label}` : option.label)} aria-selected={option.id === value} key={option.id} onClick={() => choose(option.id)}>{option.label}</button>)}
      </div>)}
    </div>, document.body)}
  </span>;
}

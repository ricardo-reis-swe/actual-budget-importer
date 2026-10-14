import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { GroupedSelectOptions, type GroupedSelectGroup } from './grouped-select.js';
import { useDisplaySettings } from './display-settings.js';

const HEADER_HEIGHT_FALLBACK = 72;

export interface CategoryPickerPanelRequest {
  ariaLabel?: string;
  emptyLabel: string;
  groups: readonly GroupedSelectGroup[];
  onChoose(value: string): void;
  showGroupLabels: boolean;
  source: object;
  trigger: HTMLElement | null;
  value: string;
}

interface CategoryPickerPanelContextValue {
  activeSource: object | undefined;
  close(): void;
  enabled: boolean;
  open(request: CategoryPickerPanelRequest): void;
}

const CategoryPickerPanelContext = createContext<CategoryPickerPanelContextValue | undefined>(undefined);

export function useCategoryPickerPanel(): CategoryPickerPanelContextValue {
  return useContext(CategoryPickerPanelContext)
    ?? { activeSource: undefined, close: () => undefined, enabled: false, open: () => undefined };
}

function useAppHeaderHeight(): void {
  useEffect(() => {
    const header = document.querySelector('.app-header');
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--app-header-height', `${header instanceof HTMLElement ? header.offsetHeight : HEADER_HEIGHT_FALLBACK}px`);
    };
    update();
    if (!(header instanceof HTMLElement)) return;
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
}

export function CategoryPickerPanelProvider({ children }: { children: ReactNode }) {
  const { categoryPanel } = useDisplaySettings();
  const [request, setRequest] = useState<CategoryPickerPanelRequest>();
  const requestRef = useRef<CategoryPickerPanelRequest | undefined>(undefined);
  useAppHeaderHeight();

  useEffect(() => { requestRef.current = request; }, [request]);

  const close = useCallback(() => {
    const active = requestRef.current;
    requestRef.current = undefined;
    setRequest(undefined);
    active?.trigger?.focus();
  }, []);

  const open = useCallback((next: CategoryPickerPanelRequest) => {
    requestRef.current = next;
    setRequest(next);
  }, []);

  const value = useMemo(
    () => ({ activeSource: request?.source, close, enabled: categoryPanel, open }),
    [request, close, categoryPanel, open],
  );

  return <CategoryPickerPanelContext.Provider value={value}>
    {children}
    {request && <CategoryPickerPanel request={request} onClose={close} />}
  </CategoryPickerPanelContext.Provider>;
}

function CategoryPickerPanel({ onClose, request }: { onClose(): void; request: CategoryPickerPanelRequest }) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    const frame = requestAnimationFrame(() => {
      const selectedOption = panel.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
      (selectedOption ?? panel.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      cancelAnimationFrame(frame);
    };
  }, [onClose]);

  const choose = (optionId: string) => {
    request.onChoose(optionId);
    onClose();
  };

  const navigate = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options[next]?.focus();
  };

  const label = request.ariaLabel ?? 'Options';

  return <>
    <div className="category-picker-panel-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }} />
    <aside ref={panel} className="category-picker-panel" role="dialog" aria-modal="true" aria-label={label}>
      <div className="category-picker-panel-header">
        <span>{label}</span>
        <button type="button" className="secondary-button category-picker-panel-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="category-picker-panel-options" role="listbox" aria-label={label} onKeyDown={navigate}>
        <GroupedSelectOptions emptyLabel={request.emptyLabel} groups={request.groups} onChoose={choose} showGroupLabels={request.showGroupLabels} value={request.value} />
      </div>
    </aside>
  </>;
}

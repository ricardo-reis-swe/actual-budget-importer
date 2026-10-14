import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupedSelectOptions } from '../src/web/grouped-select.js';

describe('grouped select options', () => {
  it('renders the empty option and grouped options with paths', () => {
    const markup = renderToStaticMarkup(createElement(GroupedSelectOptions, {
      emptyLabel: 'Uncategorized',
      groups: [{ id: 'home', label: 'Home', options: [{ id: 'bills', label: 'Bills' }] }],
      onChoose: () => undefined,
      showGroupLabels: true,
      value: '',
    }));

    expect(markup).toContain('Uncategorized');
    expect(markup).toContain('category-picker-group-heading');
    expect(markup).toContain('aria-label="Home/Bills"');
    expect(markup).toContain('aria-selected="true"');
  });

  it('marks the chosen option as selected', () => {
    const markup = renderToStaticMarkup(createElement(GroupedSelectOptions, {
      emptyLabel: 'Uncategorized',
      groups: [{ id: 'home', label: 'Home', options: [{ id: 'bills', label: 'Bills' }] }],
      onChoose: () => undefined,
      showGroupLabels: true,
      value: 'bills',
    }));

    expect(markup).toMatch(/aria-selected="true"[^>]*>Bills</);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupedParserSelect, groupParserOptions } from '../src/web/grouped-parser-select.js';

describe('grouped parser options', () => {
  it('keeps a single country in one alphabetically sorted group', () => {
    expect(groupParserOptions([
      { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink' },
      { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' },
    ])).toEqual([{
      id: 'PT',
      label: 'Portugal',
      options: [
        { id: 'activobank', label: 'ActivoBank' },
        { id: 'wizink', label: 'WiZink' },
      ],
    }]);
  });

  it('sorts multiple countries and identifies hidden parsers', () => {
    expect(groupParserOptions([
      { countryCode: 'SG', countryName: 'Singapore', enabled: false, id: 'posb-dbs', name: 'POSB/DBS' },
      { countryCode: 'PT', countryName: 'Portugal', enabled: true, id: 'activobank', name: 'ActivoBank' },
    ])).toEqual([
      { id: 'PT', label: 'Portugal', options: [{ id: 'activobank', label: 'ActivoBank' }] },
      { id: 'SG', label: 'Singapore', options: [{ id: 'posb-dbs', label: 'POSB/DBS (hidden)' }] },
    ]);
  });

  it('supports context-specific option labels', () => {
    expect(groupParserOptions([
      { countryCode: 'SG', countryName: 'Singapore', id: 'posb-dbs', name: 'POSB/DBS' },
    ], (parser) => `Only ${parser.name} statements`)[0]?.options).toEqual([
      { id: 'posb-dbs', label: 'Only POSB/DBS statements' },
    ]);
  });

  it('shows the selected country path only when multiple countries are available', () => {
    const multipleCountries = renderToStaticMarkup(createElement(GroupedParserSelect, {
      emptyLabel: 'Select a parser',
      onChange: () => undefined,
      parsers: [
        { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' },
        { countryCode: 'SG', countryName: 'Singapore', id: 'posb-dbs', name: 'POSB/DBS' },
      ],
      value: 'posb-dbs',
    }));
    expect(multipleCountries).toContain('<strong>Singapore</strong><span aria-hidden="true">/</span>POSB/DBS');

    const oneCountry = renderToStaticMarkup(createElement(GroupedParserSelect, {
      emptyLabel: 'Select a parser',
      onChange: () => undefined,
      parsers: [
        { countryCode: 'PT', countryName: 'Portugal', id: 'activobank', name: 'ActivoBank' },
        { countryCode: 'PT', countryName: 'Portugal', id: 'wizink', name: 'WiZink' },
      ],
      value: 'activobank',
    }));
    expect(oneCountry).toContain('>ActivoBank<');
    expect(oneCountry).not.toContain('<strong>Portugal</strong>');
  });
});

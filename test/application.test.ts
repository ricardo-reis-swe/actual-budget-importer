import { describe, expect, it } from 'vitest';

import { applicationName } from '../src/application.js';

describe('application workspace', () => {
  it('uses the product name', () => {
    expect(applicationName).toBe('Actual Budget Importer');
  });
});

const statementHeaders = Array.from(
  { length: 29 },
  (_, index) => [`Synthetic statement header ${index + 1}`],
);

export const activoBankRegressionRows = [
  ...statementHeaders,
  ['30/07/2026', '', 'Opening', 'balance', '', '', '', '', '', '0,00', '1.000,00'],
  ['01/08/2026', '', 'Coffee', 'shop', '', '', '', '', '', '4,50', '995,50'],
  ['02-08-2026', '', 'Salary', 'August', '', '', '', '', '', '1.000,00', '1995,50'],
  ['03-08-2026', '', 'Refund', '', '', '', '', '', '', '12,34', '2007,84'],
  ['04-08-2026', '', 'Banco ActivoBank', '', '', '', '', '', '', '0,00', '2007,84'],
  ['05-08-2026', '', 'A TRANSPORTAR', '', '', '', '', '', '', '0,00', '2007,84'],
] as const;

export const activoBankMalformedAmountRows = [
  ...statementHeaders,
  ['01-08-2026', '', 'Invalid', '', '', '', '', '', '', '1,234', '10,00'],
] as const;

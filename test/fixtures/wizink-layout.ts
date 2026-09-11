export const wizinkRegressionRows = [
  ['Data', 'Descrição', 'Montante'],
  ['01/08/2026', 'Coffee shop Lisbon', '4,50 EUR'],
  ['02-08-2026', 'Reembolso do comerciante', '12,34'],
  ['03/08/2026', 'Grocer', '1.234,56 D'],
  ['04/08/2026', 'Pagamento mensal', '100,00'],
] as const;

export const wizinkMalformedAmountRows = [
  ['Página 1 de 2'],
  ['05/08/2026', 'Malformed', '1,2'],
  ['06/08/2026', 'Valid', '10,00'],
] as const;

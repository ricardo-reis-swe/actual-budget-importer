import type { PositionedText } from '../../src/parsers/generic-table-extractor.js';

export const text = (text: string, x: number, y: number): PositionedText => ({ text, x, y });

export const ccHeaders = [
  text('DETALHE DOS MOVIMENTOS', 55, 400),
  text('Data', 55, 380), text('Data', 105, 380),
  text('Movimento', 55, 370), text('Valor', 105, 370),
  text('Descritivo', 160, 370), text('Rede', 310, 370),
  text('Débito', 455, 370), text('Crédito', 535, 370),
];

export const ccPages = [
  [text('RESUMO DA CONTA', 55, 700), text('2025/01/01 2025/01/02', 55, 650),
    text('Summary only', 160, 650), text('100.00', 465, 650)],
  [...ccHeaders,
    text('2025/01/02 2025/01/03', 55, 350), text('COMPRA Loja Exemplo', 163, 350), text('4.50', 465, 350),
    text('VIS', 319, 335),
    text('2025/01/04', 55, 320), text('2025/01/05', 105, 320),
    text('COMPRA Loja com descrição longa', 163, 320), text('1 234.56', 440, 320),
    text('continuação da descrição', 163, 305), text('VIS', 319, 305),
    text('2025/01/01 2025/01/12', 55, 290), text('>PAGAMENTO CARTAO DE CREDITO', 163, 290), text('50.00', 545, 290),
    text('Banco ActivoBank, S.A.', 13, 280),
    text('Pág. 2/3', 555, 85), text('www.activobank.pt', 55, 40)],
  [...ccHeaders,
    text('2025/01/06 2025/01/07', 55, 350), text('Reembolso Loja', 163, 350), text('12.34', 540, 350),
    text('INFORMAÇÃO SOBRE O PRÓXIMO PAGAMENTO', 55, 330),
    text('2025/01/08 2025/01/09', 55, 310), text('Outside table', 163, 310), text('9.00', 465, 310)],
];

import {
  buildExtractionSystemInstruction,
  buildExtractionUserPrompt,
  splitTextIntoExtractionChunks,
} from './invoice-extraction.prompt';

describe('invoice-extraction.prompt', () => {
  it('enforces anti-hallucination rules in system instruction', () => {
    const instruction = buildExtractionSystemInstruction();
    expect(instruction).toContain('NEVER invent');
    expect(instruction).toContain('null');
  });

  it('splits multi-page PDF text into bounded chunks preserving page boundaries', () => {
    const pages = [
      { page_number: 1, method: 'digital_text' as const, confidence: 1, text: 'A'.repeat(120) },
      { page_number: 2, method: 'digital_text' as const, confidence: 1, text: 'B'.repeat(120) },
      { page_number: 3, method: 'ocr' as const, confidence: 0.9, text: 'C'.repeat(120) },
    ];

    const chunks = splitTextIntoExtractionChunks('', pages, 200);
    expect(chunks.length).toBe(3);
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[1].pageStart).toBe(2);
    expect(chunks[2].pageStart).toBe(3);

    const prompt = buildExtractionUserPrompt('multi.pdf', chunks[1]);
    expect(prompt).toContain('Pages: 2-2');
    expect(prompt).toContain('Filename: multi.pdf');
  });
});

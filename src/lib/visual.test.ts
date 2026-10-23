import { describe, it, expect } from 'vitest';
import { BRANDED_LAYOUTS } from './visual';

// social.regenImage steps the seed by 11; createPack seeds platforms seed0*7+i. Each step must land on a new layout.
describe('Branded graphic regenerate', () => {
  it('every regenerate (seed + 11) picks a different composition', () => {
    for (let s = 1; s < 200; s++) expect((s + 11) % BRANDED_LAYOUTS).not.toBe(s % BRANDED_LAYOUTS);
  });
});

import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../src/clock.js';

describe('sequentialIds', () => {
  it('counts from 1 independently for each generator', () => {
    const a = sequentialIds('a');
    const b = sequentialIds('b');
    expect([a(), a(), b(), a()]).toEqual(['a_1', 'a_2', 'b_1', 'a_3']);
  });
});

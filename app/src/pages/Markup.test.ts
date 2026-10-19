import { describe, expect, it } from 'vitest';
import { priceWithMarkup } from './Markup';

describe('націнка', () => {
  it('округлення вгору до гривні й до 50 коп', () => {
    expect(priceWithMarkup(1030, 50, '1')).toBe(1600);
    expect(priceWithMarkup(1030, 50, '0.5')).toBe(1550);
    expect(priceWithMarkup(1000, 0, '1')).toBe(1000);
  });
  it('…9 лише коли це не більше +10%', () => {
    expect(priceWithMarkup(5700, 50, '9')).toBe(8900);
    expect(priceWithMarkup(4400, 50, '9')).toBe(6900);
    expect(priceWithMarkup(750, 50, '9')).toBe(1200);
    expect(priceWithMarkup(2080, 50, '9')).toBe(3200);
  });
});

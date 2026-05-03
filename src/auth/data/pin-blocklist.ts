/** Forbidden 6-digit PINs per BURROW_MASTER_SPEC (obvious sequences, repeats, common patterns). */

const sameDigit = (): string[] =>
  Array.from({ length: 10 }, (_, d) => String(d).repeat(6));

const sequentialAscending = (): string[] => {
  const out: string[] = [];
  for (let start = 0; start <= 4; start += 1) {
    let s = '';
    for (let i = 0; i < 6; i += 1) s += String(start + i);
    out.push(s);
  }
  return out;
};

const sequentialDescending = (): string[] => {
  const out: string[] = [];
  for (let start = 9; start >= 5; start -= 1) {
    let s = '';
    for (let i = 0; i < 6; i += 1) s += String(start - i);
    out.push(s);
  }
  return out;
};

const birthYearPins = (): string[] => {
  const out: string[] = [];
  for (let y = 1950; y <= 2010; y += 1) {
    const base = String(y);
    for (let pad = 0; pad <= 99; pad += 1) {
      const suffix = String(pad).padStart(2, '0');
      out.push(base + suffix);
    }
  }
  return out;
};

const repeatingPatterns = (): string[] => [
  '121212',
  '123123',
  '112233',
  '131313',
  '141414',
  '212121',
  '232323',
  '242424',
  '313131',
  '323232',
  '343434',
  '414141',
  '424242',
  '434343',
];

function buildWeakPinSet(): ReadonlySet<string> {
  const s = new Set<string>();
  for (const p of sameDigit()) s.add(p);
  for (const p of sequentialAscending()) s.add(p);
  for (const p of sequentialDescending()) s.add(p);
  for (const p of birthYearPins()) s.add(p);
  for (const p of repeatingPatterns()) s.add(p);
  return s;
}

const WEAK = buildWeakPinSet();

export function isWeakPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  return WEAK.has(pin);
}

/** Rough Gurgaon / Gurugram bounds (degrees). */
export const GURGAON_LAT_MIN = 28.35;
export const GURGAON_LAT_MAX = 28.55;
export const GURGAON_LNG_MIN = 76.95;
export const GURGAON_LNG_MAX = 77.15;

export function isWithinGurgaonBbox(lat: number, lng: number): boolean {
  return lat >= GURGAON_LAT_MIN && lat <= GURGAON_LAT_MAX && lng >= GURGAON_LNG_MIN && lng <= GURGAON_LNG_MAX;
}

interface AddrComp {
  long_name?: string;
  short_name?: string;
}

/** True if any component text suggests Gurgaon / Gurugram / Haryana (per product spec). */
export function addressComponentsSuggestGurgaon(components: AddrComp[]): boolean {
  for (const c of components) {
    const longN = (c.long_name ?? '').toLowerCase();
    const shortN = (c.short_name ?? '').toLowerCase();
    if (
      longN.includes('gurgaon') ||
      longN.includes('gurugram') ||
      longN.includes('haryana') ||
      shortN.includes('gurgaon') ||
      shortN.includes('gurugram') ||
      shortN.includes('haryana')
    ) {
      return true;
    }
  }
  return false;
}

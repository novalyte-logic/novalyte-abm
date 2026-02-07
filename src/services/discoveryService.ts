import axios from 'axios';
import { MarketZone } from '../types';

export interface PlaceLike {
  id?: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviewCount?: number;
  types?: string[];
  source?: 'google' | string;
  raw?: any;
}

/**
 * Search queries explicitly targeting men's health clinics only.
 * Every query includes "men" or a men-specific service to avoid
 * returning women's clinics, general spas, OB-GYN, etc.
 */
const DISCOVERY_QUERIES = [
  // Core men's health
  "men's health clinic",
  "men's wellness clinic",
  "men's vitality clinic",
  "male health center",
  "men's clinic",
  // Hormone / TRT (inherently male-focused)
  "testosterone replacement therapy clinic",
  "TRT clinic",
  "testosterone clinic",
  "low testosterone treatment clinic",
  "low T clinic",
  "hormone therapy for men",
  "hormone optimization men",
  "bioidentical hormone therapy men",
  "male hormone clinic",
  // ED / Sexual health (inherently male)
  "erectile dysfunction clinic",
  "ED treatment clinic",
  "men's sexual health clinic",
  "men's sexual wellness",
  "P-shot clinic",
  // Weight loss — men specific
  "men's weight loss clinic",
  "semaglutide clinic for men",
  "GLP-1 weight loss men",
  "tirzepatide men",
  // Med spa — men specific
  "men's med spa",
  "med spa for men",
  // IV / Peptides — men specific
  "IV therapy men's health",
  "peptide therapy men",
  "NAD+ therapy men",
  // Hair (male pattern)
  "men's hair restoration",
  "male hair transplant",
  "men's hair loss treatment",
  "PRP hair treatment men",
  // Urology (inherently male-focused in this context)
  "men's urology clinic",
  "urologist men's health",
  // Functional / Longevity — men specific
  "men's longevity clinic",
  "men's anti-aging clinic",
  "men's performance clinic",
  "executive men's health",
  "concierge men's health",
  "men's regenerative medicine",
  // Specific branded searches that are always men's
  "Gameday Men's Health",
  "Ageless Men's Health",
  "Vault Health",
  "Hone Health",
  "Opt Health",
];

/**
 * Exclusion keywords — if a place name contains any of these,
 * it's NOT a men's health clinic and should be filtered out.
 */
const EXCLUSION_KEYWORDS = [
  'women', "women's", 'woman', 'female', 'feminine', 'fertility',
  'ob-gyn', 'obgyn', 'ob/gyn', 'obstetric', 'gynecolog', 'midwife',
  'prenatal', 'maternity', 'pregnancy', 'mammogram',
  'nail', 'nails', 'lash', 'lashes', 'brow', 'waxing',
  'beauty salon', 'hair salon', 'barbershop', 'barber shop',
  'spa & salon', 'day spa', 'facial spa',
  'dental', 'dentist', 'orthodont', 'optometr', 'eye care', 'vision',
  'chiropract', 'physical therapy', 'occupational therapy',
  'veterinar', 'animal', 'pet ',
  'pediatric', 'children', 'kids',
  'mental health', 'psychiatr', 'psycholog', 'counseling center',
  'pharmacy', 'cvs', 'walgreens', 'rite aid',
  'hospital', 'emergency room',
  'insurance', 'billing',
];

const PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.types',
].join(',');

/**
 * Generate grid offset points around a center coordinate.
 * This ensures we cover the full metro area, not just the city center.
 * Returns the center + 8 surrounding points at the given offset distance.
 */
function gridPoints(lat: number, lng: number, offsetMiles: number): Array<{ lat: number; lng: number }> {
  if (offsetMiles <= 0) return [{ lat, lng }];
  // ~1 degree lat ≈ 69 miles, ~1 degree lng ≈ 69 * cos(lat) miles
  const latOff = offsetMiles / 69;
  const lngOff = offsetMiles / (69 * Math.cos((lat * Math.PI) / 180));
  return [
    { lat, lng },                             // center
    { lat: lat + latOff, lng },               // N
    { lat: lat - latOff, lng },               // S
    { lat, lng: lng + lngOff },               // E
    { lat, lng: lng - lngOff },               // W
    { lat: lat + latOff, lng: lng + lngOff }, // NE
    { lat: lat + latOff, lng: lng - lngOff }, // NW
    { lat: lat - latOff, lng: lng + lngOff }, // SE
    { lat: lat - latOff, lng: lng - lngOff }, // SW
  ];
}

export class DiscoveryService {
  private apiKey: string;

  constructor() {
    const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : {};
    this.apiKey = env?.VITE_GEMINI_API_KEY || env?.VITE_GOOGLE_PLACES_API_KEY || '';
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Google Places API (New) — Text Search.
   * CORS-friendly, returns up to 20 rich results per call.
   */
  private async searchPlacesNew(
    query: string,
    lat: number,
    lng: number,
    radiusMeters = 50000
  ): Promise<PlaceLike[]> {
    if (!this.apiKey) return [];

    try {
      const resp = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        {
          textQuery: query,
          maxResultCount: 20,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: Math.min(radiusMeters, 50000),
            },
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': PLACE_FIELDS,
          },
          timeout: 15000,
        }
      );

      return (resp.data?.places || []).map((p: any): PlaceLike => ({
        id: p.id,
        placeId: p.id,
        name: p.displayName?.text || 'Unknown',
        address: p.formattedAddress || '',
        phone: p.nationalPhoneNumber || undefined,
        website: p.websiteUri || undefined,
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating,
        reviewCount: p.userRatingCount,
        types: p.types || [],
        source: 'google',
        raw: p,
      }));
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err.message;
      console.warn(`Places search failed: ${msg}`);
      return [];
    }
  }

  /**
   * Exhaustive grid search over a single market.
   *
   * Strategy:
   * - 9 grid points (center + 8 surrounding at ~15mi offset)
   * - Every discovery query at each grid point
   * - 20 results per API call × 44 queries × 9 points = up to 7,920 raw hits
   * - Deduped by placeId → typically yields 50-200+ unique clinics per market
   */
  async gridSearchMarket(
    market: MarketZone,
    options?: {
      onProgress?: (msg: string, found: number) => void;
    }
  ): Promise<PlaceLike[]> {
    const onProgress = options?.onProgress;
    const points = gridPoints(market.coordinates.lat, market.coordinates.lng, 15);
    const radiusMeters = 25000; // 25km per point — overlaps ensure full coverage

    const allResults: PlaceLike[] = [];
    let opsDone = 0;

    for (const query of DISCOVERY_QUERIES) {
      for (const pt of points) {
        opsDone++;
        if (opsDone % 9 === 1) {
          // Report progress every full query cycle (once per query across all points)
          onProgress?.(
            `${market.city}: "${query}" (${Math.ceil(opsDone / points.length)}/${DISCOVERY_QUERIES.length})`,
            this.countUnique(allResults)
          );
        }

        const results = await this.searchPlacesNew(
          `${query} in ${market.city}, ${market.state}`,
          pt.lat, pt.lng, radiusMeters
        );
        allResults.push(...results);
        await this.delay(200);
      }
    }

    const deduped = this.dedup(allResults);
    // Filter out non-men's-health results
    const filtered = this.filterMensHealthOnly(deduped);
    onProgress?.(`${market.city}: ${filtered.length} men's health clinics found`, filtered.length);
    return filtered;
  }

  /**
   * Discover clinics across ALL markets sequentially.
   */
  async discoverAllMarkets(
    markets: MarketZone[],
    callbacks?: {
      onProgress?: (msg: string, totalFound: number) => void;
      onMarketComplete?: (market: MarketZone, places: PlaceLike[]) => void;
    }
  ): Promise<PlaceLike[]> {
    const all: PlaceLike[] = [];

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      callbacks?.onProgress?.(
        `Market ${i + 1}/${markets.length}: ${market.city}, ${market.state}`,
        all.length
      );

      const places = await this.gridSearchMarket(market, {
        onProgress: callbacks?.onProgress,
      });

      all.push(...places);
      callbacks?.onMarketComplete?.(market, places);
    }

    return all;
  }

  // ─── Men's health filter ───

  private filterMensHealthOnly(results: PlaceLike[]): PlaceLike[] {
    return results.filter(r => {
      const name = (r.name || '').toLowerCase();

      // Reject if name matches any exclusion keyword
      for (const excl of EXCLUSION_KEYWORDS) {
        if (name.includes(excl)) return false;
      }

      // Reject Google place types that are clearly not men's health
      const badTypes = ['beauty_salon', 'hair_care', 'spa', 'gym', 'dentist', 'veterinary_care', 'pharmacy', 'hospital'];
      if (r.types?.some(t => badTypes.includes(t))) {
        // Exception: if name explicitly says "men" it's probably fine
        if (!name.includes('men')) return false;
      }

      return true;
    });
  }

  // ─── Deduplication by placeId (canonical) ───

  private dedup(results: PlaceLike[]): PlaceLike[] {
    const map = new Map<string, PlaceLike>();
    for (const r of results) {
      const key = r.placeId
        || `${(r.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(r.address || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (!map.has(key)) {
        map.set(key, r);
      } else {
        const existing = map.get(key)!;
        const score = (p: PlaceLike) => (p.reviewCount || 0) + (p.phone ? 10 : 0) + (p.website ? 10 : 0);
        if (score(r) > score(existing)) map.set(key, r);
      }
    }
    return Array.from(map.values());
  }

  private countUnique(results: PlaceLike[]): number {
    return new Set(results.map(r => r.placeId || r.name)).size;
  }

  mergeAndDedupePlaces(results: PlaceLike[]): PlaceLike[] {
    return this.dedup(results);
  }
}

export const discoveryService = new DiscoveryService();

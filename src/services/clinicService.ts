import axios from 'axios';
import { Clinic, ClinicType, MarketZone } from '../types';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  geometry: {
    location: { lat: number; lng: number };
  };
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

// Search queries to find men's health clinics
const CLINIC_SEARCH_QUERIES = [
  "men's health clinic",
  'testosterone clinic',
  'TRT clinic',
  'hormone therapy clinic',
  'med spa for men',
  'urology clinic',
  'sexual health clinic',
  'anti-aging clinic',
  'IV therapy clinic',
  'peptide therapy',
  'weight loss clinic GLP-1',
  'hair restoration clinic',
];

export class ClinicService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || import.meta.env.VITE_GOOGLE_PLACES_API_KEY || '';
  }

  /**
   * Discover clinics in a specific market zone
   */
  async discoverClinicsInMarket(market: MarketZone): Promise<Clinic[]> {
    const clinics: Clinic[] = [];
    const seenPlaceIds = new Set<string>();

    for (const query of CLINIC_SEARCH_QUERIES) {
      try {
        const searchResults = await this.searchPlaces(query, market);
        
        for (const place of searchResults) {
          if (seenPlaceIds.has(place.place_id)) continue;
          seenPlaceIds.add(place.place_id);

          const details = await this.getPlaceDetails(place.place_id);
          if (details) {
            const clinic = this.mapToClinic(details, market);
            clinics.push(clinic);
          }
          
          await this.delay(100); // Rate limiting
        }
      } catch (error) {
        console.error(`Error searching for "${query}" in ${market.city}:`, error);
      }
    }

    return clinics;
  }

  /**
   * Search for places using text query
   */
  private async searchPlaces(query: string, market: MarketZone): Promise<PlaceResult[]> {
    const response = await axios.get(`${PLACES_BASE}/textsearch/json`, {
      params: {
        query: `${query} in ${market.city}, ${market.state}`,
        location: `${market.coordinates.lat},${market.coordinates.lng}`,
        radius: 25000, // 25km radius
        type: 'health',
        key: this.apiKey,
      },
    });

    return response.data.results || [];
  }

  /**
   * Get detailed information about a place
   */
  private async getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
    try {
      const response = await axios.get(`${PLACES_BASE}/details/json`, {
        params: {
          place_id: placeId,
          fields: 'place_id,name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,types,address_components,geometry',
          key: this.apiKey,
        },
      });

      return response.data.result || null;
    } catch (error) {
      console.error(`Error getting details for place ${placeId}:`, error);
      return null;
    }
  }

  /**
   * Map Google Places result to our Clinic type
   */
  private mapToClinic(place: PlaceResult, market: MarketZone): Clinic {
    const addressParts = this.parseAddress(place);
    
    return {
      id: `clinic-${place.place_id}`,
      name: place.name,
      type: this.inferClinicType(place),
      address: {
        street: addressParts.street,
        city: addressParts.city || market.city,
        state: addressParts.state || market.state,
        zip: addressParts.zip,
        country: 'USA',
      },
      phone: place.formatted_phone_number || '',
      website: place.website,
      googlePlaceId: place.place_id,
      rating: place.rating,
      reviewCount: place.user_ratings_total,
      services: this.inferServices(place),
      marketZone: market,
      discoveredAt: new Date(),
      lastUpdated: new Date(),
    };
  }

  /**
   * Parse address components from Google Places
   */
  private parseAddress(place: PlaceResult): {
    street: string;
    city: string;
    state: string;
    zip: string;
  } {
    const components = place.address_components || [];
    
    const getComponent = (type: string): string => {
      const comp = components.find(c => c.types.includes(type));
      return comp?.long_name || '';
    };

    const streetNumber = getComponent('street_number');
    const streetName = getComponent('route');

    return {
      street: `${streetNumber} ${streetName}`.trim(),
      city: getComponent('locality') || getComponent('sublocality'),
      state: components.find(c => c.types.includes('administrative_area_level_1'))?.short_name || '',
      zip: getComponent('postal_code'),
    };
  }

  /**
   * Infer clinic type from place data
   */
  private inferClinicType(place: PlaceResult): ClinicType {
    const name = place.name.toLowerCase();
    const types = place.types || [];

    if (name.includes('urology') || types.includes('urologist')) {
      return 'urology_practice';
    }
    if (name.includes('med spa') || name.includes('medspa')) {
      return 'med_spa';
    }
    if (name.includes('hormone') || name.includes('trt') || name.includes('testosterone')) {
      return 'hormone_clinic';
    }
    if (name.includes('anti-aging') || name.includes('anti aging') || name.includes('longevity')) {
      return 'anti_aging_clinic';
    }
    if (name.includes('wellness') || name.includes('vitality')) {
      return 'wellness_center';
    }
    if (name.includes('aesthetic')) {
      return 'aesthetic_clinic';
    }
    
    return 'mens_health_clinic';
  }

  /**
   * Infer services offered based on place name and type
   */
  private inferServices(place: PlaceResult): string[] {
    const name = place.name.toLowerCase();
    const services: string[] = [];

    if (name.includes('trt') || name.includes('testosterone')) {
      services.push('TRT', 'Hormone Therapy');
    }
    if (name.includes('iv') || name.includes('infusion')) {
      services.push('IV Therapy');
    }
    if (name.includes('peptide')) {
      services.push('Peptide Therapy');
    }
    if (name.includes('weight') || name.includes('glp') || name.includes('semaglutide')) {
      services.push('Weight Loss', 'GLP-1 Therapy');
    }
    if (name.includes('hair') || name.includes('restoration')) {
      services.push('Hair Restoration');
    }
    if (name.includes('sexual') || name.includes('ed ') || name.includes('erectile')) {
      services.push('ED Treatment', 'Sexual Health');
    }
    if (name.includes('prp')) {
      services.push('PRP Therapy');
    }

    return services.length > 0 ? services : ['General Men\'s Health'];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const clinicService = new ClinicService();

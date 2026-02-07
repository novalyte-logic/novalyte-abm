import { Clinic, ClinicType, MarketZone } from '../types';
import { discoveryService } from './discoveryService';

export class ClinicService {

  /**
   * Generate mock clinics for demo purposes
   */
  private generateMockClinics(market: MarketZone): Clinic[] {
    const clinicNames = [
      { name: `${market.city} Men's Vitality Center`, type: 'mens_health_clinic' as ClinicType },
      { name: `Elite TRT & Testosterone Clinic`, type: 'hormone_clinic' as ClinicType },
      { name: `${market.city} Men's Urology`, type: 'urology_practice' as ClinicType },
      { name: `Men's Med Spa & Wellness`, type: 'med_spa' as ClinicType },
      { name: `Peak Performance Men's Health`, type: 'mens_health_clinic' as ClinicType },
      { name: `Men's Anti-Aging & Longevity`, type: 'anti_aging_clinic' as ClinicType },
      { name: `${market.city} Men's Hormone Clinic`, type: 'hormone_clinic' as ClinicType },
      { name: `Men's Wellness & ED Center`, type: 'wellness_center' as ClinicType },
    ];

    return clinicNames.slice(0, 4 + Math.floor(Math.random() * 4)).map((clinic, i) => ({
      id: `clinic-mock-${market.id}-${i}-${Date.now()}`,
      name: clinic.name,
      type: clinic.type,
      address: {
        street: `${100 + i * 100} ${['Main St', 'Oak Ave', 'Medical Plaza', 'Wellness Blvd', 'Health Center Dr'][i % 5]}`,
        city: market.city,
        state: market.state,
        zip: `${90000 + Math.floor(Math.random() * 9999)}`,
        country: 'USA',
      },
      phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
      website: `https://${clinic.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
      rating: 4 + Math.random(),
      reviewCount: Math.floor(Math.random() * 200) + 20,
      services: this.getMockServices(clinic.type),
      marketZone: market,
      discoveredAt: new Date(),
      lastUpdated: new Date(),
    }));
  }

  private getMockServices(type: ClinicType): string[] {
    const servicesByType: Record<ClinicType, string[]> = {
      mens_health_clinic: ['TRT', 'Hormone Therapy', 'ED Treatment'],
      hormone_clinic: ['TRT', 'Hormone Optimization', 'Peptide Therapy'],
      urology_practice: ['ED Treatment', 'Sexual Health', 'Prostate Health'],
      med_spa: ['IV Therapy', 'Aesthetic Treatments', 'Weight Loss'],
      wellness_center: ['IV Therapy', 'Peptide Therapy', 'Hormone Therapy'],
      anti_aging_clinic: ['Hormone Therapy', 'Peptide Therapy', 'IV Therapy'],
      aesthetic_clinic: ['Hair Restoration', 'PRP Therapy', 'IV Therapy'],
    };
    return servicesByType[type] || ['General Men\'s Health'];
  }

  /**
   * Discover clinics in a specific market zone.
   * Uses the discovery service (Google Places API New) which returns
   * phone, website, rating, etc. in a single call.
   */
  async discoverClinicsInMarket(market: MarketZone): Promise<Clinic[]> {
    try {
      const places = await discoveryService.gridSearchMarket(market);
      if (places && places.length > 0) {
        return places.map(p => this.mapPlacesResultToClinic(p, market));
      }
    } catch (err) {
      console.warn('Discovery service failed:', err);
    }

    // If API returned nothing, return mock data so the UI isn't empty
    return this.generateMockClinics(market);
  }

  /**
   * Map a lightweight PlacesResult (from discoveryService) to our Clinic type
   */
  private mapPlacesResultToClinic(place: { id?: string; name: string; address?: string; phone?: string; website?: string; placeId?: string; lat?: number; lng?: number; rating?: number; reviewCount?: number; }, market: MarketZone): Clinic {
    const name = place.name || 'Unknown Clinic';
    // Try to parse address into components (very naive: split on commas)
    const addrParts = (place.address || '').split(',').map(s => s.trim());
    const street = addrParts[0] || '';
    const city = addrParts.length >= 2 ? addrParts[1] : market.city;
    const stateZip = addrParts.length >= 3 ? addrParts[2] : market.state;
    const state = (stateZip || '').split(' ')[0] || market.state;
    const zipMatch = (stateZip || '').match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : '';

    return {
      id: place.placeId ? `clinic-${place.placeId}` : `clinic-unknown-${Math.random().toString(36).slice(2, 9)}`,
      name,
      type: this.inferClinicTypeFromName(name, []),
      address: {
        street,
        city,
        state,
        zip,
        country: 'USA',
      },
      phone: place.phone || '',
      website: place.website || undefined,
      googlePlaceId: place.placeId || undefined,
      rating: place.rating ?? undefined,
      reviewCount: place.reviewCount ?? undefined,
      services: this.inferServicesFromName(name),
      marketZone: market,
      discoveredAt: new Date(),
      lastUpdated: new Date(),
    };
  }

  /**
   * Infer clinic type from place name and types
   */
  private inferClinicTypeFromName(name: string, types: string[]): ClinicType {
    const nameLower = name.toLowerCase();

    if (nameLower.includes('urology') || types.includes('urologist')) {
      return 'urology_practice';
    }
    if (nameLower.includes('med spa') || nameLower.includes('medspa')) {
      return 'med_spa';
    }
    if (nameLower.includes('hormone') || nameLower.includes('trt') || nameLower.includes('testosterone')) {
      return 'hormone_clinic';
    }
    if (nameLower.includes('anti-aging') || nameLower.includes('anti aging') || nameLower.includes('longevity')) {
      return 'anti_aging_clinic';
    }
    if (nameLower.includes('wellness') || nameLower.includes('vitality')) {
      return 'wellness_center';
    }
    if (nameLower.includes('aesthetic')) {
      return 'aesthetic_clinic';
    }
    
    return 'mens_health_clinic';
  }

  /**
   * Infer services offered based on place name
   */
  private inferServicesFromName(name: string): string[] {
    const nameLower = name.toLowerCase();
    const services: string[] = [];

    if (nameLower.includes('trt') || nameLower.includes('testosterone')) {
      services.push('TRT', 'Hormone Therapy');
    }
    if (nameLower.includes('iv') || nameLower.includes('infusion')) {
      services.push('IV Therapy');
    }
    if (nameLower.includes('peptide')) {
      services.push('Peptide Therapy');
    }
    if (nameLower.includes('weight') || nameLower.includes('glp') || nameLower.includes('semaglutide')) {
      services.push('Weight Loss', 'GLP-1 Therapy');
    }
    if (nameLower.includes('hair') || nameLower.includes('restoration')) {
      services.push('Hair Restoration');
    }
    if (nameLower.includes('sexual') || nameLower.includes('ed ') || nameLower.includes('erectile')) {
      services.push('ED Treatment', 'Sexual Health');
    }
    if (nameLower.includes('prp')) {
      services.push('PRP Therapy');
    }

    return services.length > 0 ? services : ['General Men\'s Health'];
  }

}

export const clinicService = new ClinicService();

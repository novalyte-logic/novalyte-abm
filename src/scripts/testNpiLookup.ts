import { enrichmentService } from '../services/enrichmentService';
import type { Clinic } from '../types';

async function run() {
  const clinic: Clinic = {
    id: 'test-1',
    name: 'Mayo Clinic',
    type: 'wellness_center',
    address: {
      street: '200 1st St SW',
      city: 'Rochester',
      state: 'MN',
      zip: '55905',
      country: 'US',
    },
    phone: '',
    email: undefined,
    website: undefined,
    googlePlaceId: undefined,
    yelpId: undefined,
    rating: undefined,
    reviewCount: undefined,
    services: ['primary care'],
    marketZone: { id: 'market-test-1', city: 'Springfield', state: 'IL', metropolitanArea: 'Springfield', medianIncome: 50000, population: 100000, affluenceScore: 5, coordinates: { lat: 39.7817, lng: -89.6501 } },
    discoveredAt: new Date(),
    lastUpdated: new Date(),
  };

  console.log('Searching NPI for:', clinic.name);
  const dms = await enrichmentService.findDecisionMakers(clinic);
  console.log('Decision makers found:', dms.length);
  console.dir(dms, { depth: 3 });
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

import { describe, it, expect } from 'vitest';
import { DiscoveryService, PlaceLike } from './discoveryService';

describe('DiscoveryService - mergeAndDedupePlaces', () => {
  const service = new DiscoveryService();

  it('should remove exact duplicates by name and address', () => {
    const places: PlaceLike[] = [
      { name: 'Alpha Clinic', address: '123 Main St, City, CA' },
      { name: 'Alpha Clinic', address: '123 Main St, City, CA' },
    ];
    const result = service.mergeAndDedupePlaces(places);
    expect(result).toHaveLength(1);
  });

  it('should normalize whitespace and punctuation', () => {
    const places: PlaceLike[] = [
      { name: 'Alpha  Clinic', address: '123 Main St.' },
      { name: 'Alpha Clinic', address: '123 Main St' },
    ];
    const result = service.mergeAndDedupePlaces(places);
    expect(result).toHaveLength(1);
  });

  it('should prefer entry with higher score', () => {
    const places: PlaceLike[] = [
      { name: 'Beta Clinic', address: '456 Oak Ave', reviewCount: 5 },
      { name: 'Beta Clinic', address: '456 Oak Ave', reviewCount: 20, phone: '555-1234', website: 'https://beta.com' },
    ];
    const result = service.mergeAndDedupePlaces(places);
    expect(result).toHaveLength(1);
    expect(result[0].reviewCount).toBe(20);
    expect(result[0].phone).toBe('555-1234');
  });

  it('should keep different clinics separate', () => {
    const places: PlaceLike[] = [
      { name: 'Gamma Clinic', address: '789 Pine Rd' },
      { name: 'Delta Clinic', address: '789 Pine Rd' },
    ];
    const result = service.mergeAndDedupePlaces(places);
    expect(result).toHaveLength(2);
  });

  it('should handle empty input', () => {
    const result = service.mergeAndDedupePlaces([]);
    expect(result).toHaveLength(0);
  });
});

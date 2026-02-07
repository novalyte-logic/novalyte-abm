import { describe, it, expect } from 'vitest';
import { DiscoveryService, PlaceLike } from '../discoveryService';

describe('DiscoveryService.mergeAndDedupePlaces', () => {
  const svc = new DiscoveryService();

  it('dedupes and prefers entry with phone', () => {
    const p1: PlaceLike = { name: 'Clinic A', address: '123 Main St', reviewCount: 10 };
    const p2: PlaceLike = { name: 'Clinic A', address: '123 Main St', phone: '555-1111', reviewCount: 2 };

    const res = svc.mergeAndDedupePlaces([p1, p2]);
    expect(res).toHaveLength(1);
    expect(res[0].phone).toBe('555-1111');
  });

  it('prefers entry with higher review count when no phone/website', () => {
    const p1: PlaceLike = { name: 'Clinic B', address: '456 Oak Ave', reviewCount: 5 };
    const p2: PlaceLike = { name: 'Clinic B', address: '456 Oak Ave', reviewCount: 20 };

    const res = svc.mergeAndDedupePlaces([p1, p2]);
    expect(res).toHaveLength(1);
    expect(res[0].reviewCount).toBe(20);
  });

  it('keeps separate different addresses', () => {
    const p1: PlaceLike = { name: 'Clinic C', address: '1 A St', reviewCount: 1 };
    const p2: PlaceLike = { name: 'Clinic C', address: '2 B St', reviewCount: 1 };

    const res = svc.mergeAndDedupePlaces([p1, p2]);
    expect(res).toHaveLength(2);
  });
});

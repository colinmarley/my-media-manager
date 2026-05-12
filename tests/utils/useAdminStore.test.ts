/**
 * Tests for src/store/useAdminStore.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import useAdminStore from '@/store/useAdminStore';

function resetStore() {
  useAdminStore.setState({ selectedType: 'Movie' });
}

describe('useAdminStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with selectedType Movie', () => {
      const { selectedType } = useAdminStore.getState();
      expect(selectedType).toBe('Movie');
    });
  });

  describe('setSelectedType', () => {
    it('updates selectedType to Series', () => {
      useAdminStore.getState().setSelectedType('Series');
      expect(useAdminStore.getState().selectedType).toBe('Series');
    });

    it('updates selectedType to Episode', () => {
      useAdminStore.getState().setSelectedType('Episode');
      expect(useAdminStore.getState().selectedType).toBe('Episode');
    });

    it('updates selectedType when called multiple times', () => {
      useAdminStore.getState().setSelectedType('Series');
      useAdminStore.getState().setSelectedType('Movie');
      expect(useAdminStore.getState().selectedType).toBe('Movie');
    });
  });
});

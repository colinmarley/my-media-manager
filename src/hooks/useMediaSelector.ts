import { useState } from 'react';
import { OmdbResponseFull, OmdbSearchResponse } from '../types/OmdbResponse.type';

export interface UseMediaSelectorReturn {
  media: OmdbResponseFull | null;
  setMedia: (media: OmdbResponseFull) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  selectedMediaId: string | null;
  setSelectedMediaId: (id: string | null) => void;
  selectedMediaInfo: OmdbResponseFull | null;
  setSelectedMediaInfo: (media: OmdbResponseFull | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  userPreferences: Record<string, any>;
  setUserPreferences: (preferences: Record<string, any>) => void;
  searchResults: OmdbSearchResponse[];
  setSearchResults: (results: OmdbSearchResponse[]) => void;
  clearSearchResults: () => void;
}

const useMediaSelector = (): UseMediaSelectorReturn => {
  const [media, setMedia] = useState<OmdbResponseFull | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedMediaInfo, setSelectedMediaInfo] = useState<OmdbResponseFull | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [userPreferences, setUserPreferences] = useState<Record<string, any>>({});
  const [searchResults, setSearchResults] = useState<OmdbSearchResponse[]>([]);

  const clearSearchResults = () => setSearchResults([]);

  return {
    media,
    setMedia,
    loading,
    setLoading,
    error,
    setError,
    selectedMediaId,
    setSelectedMediaId,
    selectedMediaInfo,
    setSelectedMediaInfo,
    searchQuery,
    setSearchQuery,
    userPreferences,
    setUserPreferences,
    searchResults,
    setSearchResults,
    clearSearchResults,
  };
};

export default useMediaSelector;
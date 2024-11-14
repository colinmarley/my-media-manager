"use client";

import { useState } from 'react';
import SearchBar from './components/SearchBar';
import MovieList from './components/MovieList';
import CollectionList from './components/CollectionList';
import styles from './Media.module.css';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';

const Page = () => {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [collection, setCollection] = useState<OmdbSearchResponse[]>([]);

  

  const handleAddToCollection = (movie: any) => {
    setCollection([...collection, movie]);
  };

  return (
    <div className={styles.container}>
      <SearchBar setSearchResults={setSearchResults} />
      <div className={styles.listsContainer}>
        <MovieList movies={searchResults} onAddToCollection={handleAddToCollection} />
        <CollectionList collection={collection} />
      </div>
    </div>
  );
};

export default Page;
"use client";

import { useState } from 'react';
import SearchBar from './_components/SearchBar';
import MovieList from './_components/MovieList';
import CollectionList from './_components/CollectionList';
import styles from './_styles/Media.module.css';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import MediaInformation from './info/_components/MediaInformation';
import useMediaSelector from '@/hooks/useMediaSelector';
import { retrieveMediaDataById } from '@/service/OmdbService';

const Page = () => {
  const [collection, setCollection] = useState<OmdbSearchResponse[]>([]);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const { setSelectedMediaId, selectedMediaInfo, setSelectedMediaInfo } = useMediaSelector();


  const retrieveFullMediaInfo = async (mediaId: string) => {
    if (!mediaId) return;
    const mediaData = await retrieveMediaDataById(mediaId);
    setSelectedMediaInfo(mediaData);
  }

  const handleAddToCollection = (movie: OmdbSearchResponse) => {
    console.log('Adding movie to collection', movie);
    console.log("Movie Type", typeof movie);
    setCollection([...collection, movie]);
  };

  const handleExpand = (movie: OmdbSearchResponse) => {
    console.log('Expanding movie', movie);
    setSelectedMediaId(movie.imdbID);
    setShowPreview(true);
    retrieveFullMediaInfo(movie.imdbID);
  }

  return (
    <div className={styles.container}>
      <SearchBar />
      <div className={styles.listsContainer}>
        <MovieList onAddToCollection={handleAddToCollection} onExpand={handleExpand} />
        {(showPreview) ? <MediaInformation data={selectedMediaInfo}/> : <CollectionList collection={collection} />}
      </div>
    </div>
  );
};

export default Page;
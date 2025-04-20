"use client";

import { useState } from 'react';
import SearchBar from './_components/SearchBar';
import MovieList from './_components/MovieList';
import CollectionList from './_components/CollectionList';
import styles from './_styles/Media.module.css';
import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import MediaInformation from './info/_components/MediaInformation';
import useMediaSelector from '@/hooks/useMediaSelector';
import { retrieveMediaDataById } from '@/service/omdb/OmdbService';
import Grid from '@mui/material/Grid2';

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
    <Grid container>
      <Grid
        size={12}
        sx={Styles.searchBarContainer} >
        <SearchBar />
      </Grid>
      <Grid
        size={6}
        sx={Styles.scrollableSection}>
        <MovieList
          onAddToCollection={handleAddToCollection}
          onExpand={handleExpand} />
      </Grid>
      <Grid
        size={6}
        sx={Styles.scrollableSection}>
        {(showPreview) ?
          <MediaInformation data={selectedMediaInfo}/> :
          <CollectionList collection={collection} />}
      </Grid>
    </Grid>
  );
};

const Styles = {
  searchBarContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%'
  },
  movieListContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  collectionListContainer: {
    display: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollableSection: {
    display: 'flex-start',
    overflowY: 'scroll',
    height: '100vh',
  }
}

export default Page;
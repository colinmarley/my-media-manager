import React, { useEffect, useState } from 'react';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import FirestoreService from '../../../service/firebase/FirestoreService';
import FormControl from '@mui/material/FormControl';
import { FormTextField } from './formInputs/common/FormTextField';
import DirectorInput from './formInputs/DirectorInput';
import { Movie } from '../../../types/collections/Movie.type';
import { ImageFile, MovieDirector, RatingEntry } from '@/types/collections/Common.type';
import { OmdbResponseFull, OmdbSearchResponse, Rating } from '../../../types/OmdbResponse.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import { retrieveMediaDataById, searchByText } from '@/service/omdb/OmdbService';
import styles from '../_styles/MovieForm.module.css';
import RatingsInput from './formInputs/RatingsInput';
import { Box } from '@mui/material';
import CastInput from './formInputs/common/CastInput';
import WritersInput from './formInputs/WritersInput';
import MovieTitleSearch from './formInputs/movie/MovieTitleSearch';
import MovieDetailsInput from './formInputs/movie/MovieDetailsInput';
import MovieLinkInput from './formInputs/movie/MovieLinkInput';
import MovieOptionalInput from './formInputs/movie/MovieOptionalInput';
import SubmitButton from '@/app/_components/SubmitButton';
import useAddMovie from '@/hooks/newMedia/useAddMovie';
import AddDirectorModule from './formInputs/modals/AddDirectorModule';
import AddActorModule from './formInputs/modals/AddActorModule';
import CastDataGrid from './formInputs/common/CastDataGrid';
import { ActorPreview } from '@/types/collections/Common.type';
import useFormStore from '@/store/useFormStore';
import DirectorDataGrid from './formInputs/common/DirectorDataGrid';


interface ValidationErrors {
    title: string | null;
    year: string | null;
    countryOfOrigin: string | null;
    directors: string | null;
    imageFiles: string | null;
    releaseDate: string | null;
    runtime: string | null;
    topCast: string | null;
    writers: string | null;
    genres: string | null;
    language: string | null;
    rated: string | null;
    plot: string | null;
    awards: string | null;
    metascore: string | null;
    imdbRating: string | null;
    imdbVotes: string | null;
}

const MovieForm: React.FC = () => {
    const {
        shouldShowAddActorModal,
        shouldShowAddDirectorModal,
        openAddActorModal,
        closeAddActorModal,
        openAddDirectorModal,
        closeAddDirectorModal,
    } = useFormStore();

    // Use the custom hook for managing movie data
    const {
        // id, setId,
        title, setTitleValue,
        countries, setCountriesValue,
        directors, setDirectorsValue, addDirector,
        genres, setGenresValue,
        imageFiles, setImageFilesValue,
        languages, setLanguagesValue,
        letterboxdLink, setLetterboxdLinkValue,
        plexLink, setPlexLinkValue,
        releaseDate, setReleaseDateValue,
        releases, setReleasesValue,
        runtime, setRuntimeValue,
        cast, setCastValue,
        writers, setWritersValue,
        omdbData, setOmdbDataValue,
        omdbResults, setOmdbResultsValue,
        ratings, setRatingsValue,
        imdbId, setImdbIdValue,
        certification, setCertificationValue,
        plot, setPlotValue,
        clearAll,
    } = useAddMovie();

    const movieService = new FirestoreService('movies');

    useEffect(() => {

        // Format certain fields in the OMDB data and set the form fields accordingly
        const formattedReleaseDate = omdbData?.value?.Released.split(' ').join('-') || '';
        const runtimeInMinutes = omdbData?.value?.Runtime.split(" ")[0];
        const formattedRuntime = `${Math.floor(Number(runtimeInMinutes) / 60)}:${Number(runtimeInMinutes) % 60}:00`;
        

        setTitleValue(omdbData?.value?.Title || '');
        setLetterboxdLinkValue(omdbData?.value?.Website || '');
        setReleaseDateValue(formattedReleaseDate || '');
        setRuntimeValue(formattedRuntime || '');
        setImdbIdValue(omdbData?.value?.imdbID || '');
        setCertificationValue(omdbData?.value?.Rated || '');
        setPlotValue(omdbData?.value?.Plot || '');
        setCountriesValue(
            omdbData?.value?.Country
            .split(',')
            .map((country: string) => 
                country.trim()
            ) || []
        );
        setDirectorsValue(
            omdbData?.value?.Director
            .split(',')
            .map((director: string) => (
                {name: director || '', title: '', directorId: ''} as MovieDirector
            )).concat(directors?.value) || []
        );
        if (omdbData?.value?.Poster) {setImageFilesValue(
            [...imageFiles.value,
                { fileName: omdbData?.value?.Poster || '', fileSize: '0', resolution: '', format: '' } as ImageFile
            ])
        };
        setCastValue(omdbData?.value?.Actors.split(',').map((actorName: string) => ({ name: actorName, characters: [], actorId: '' })) || []);
        setWritersValue(omdbData?.value?.Writer.split(',').map((writer: string) => writer.trim()) || []);
        setGenresValue(omdbData?.value?.Genre.split(',').map((genre: string) => genre.trim()) || []);
        setLanguagesValue(omdbData?.value?.Language.split(',').map((language: string) => language.trim()) || []);
        setRatingsValue(omdbData?.value?.Ratings.map((ratingData: Rating) => ({source: ratingData.Source, value: ratingData.Value})) || []);
    }, [omdbData]);

    const handleMovieTitleSearch = async (title: string) => {
        const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
        setOmdbResultsValue(omdbSearchResults);
    };

    const handleAddDirector = () => {
        setDirectorsValue([...directors?.value, { name: '', title: '', directorId: '' } as MovieDirector]);
    };

    const handleSetRatings = (ratings: RatingEntry[]) => {
        setRatingsValue(ratings);
    };

    const handleDirectorChange = (index: number, field: keyof MovieDirector, value: string) => {
        const newDirectors = [...directors.value];
        newDirectors[index][field] = value;
        setDirectorsValue(newDirectors);
    };

    const handleMovieSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
        //check if the imdbId is already in the database
        const movieService = new FirestoreService('movies');
        const existingMovie = await movieService.getDocumentsByField('omdbData.imdbID', selectedImdbId);
        if (existingMovie.length > 0) {
            console.log("Found Movie in DB")
            alert("Movie already exists in database");
            return;
        }
        
        const fullMovieData = await retrieveMediaDataById(selectedImdbId)
        handleResetFields();
        setOmdbDataValue(null);
        setOmdbDataValue(fullMovieData);
        setOmdbResultsValue([]); // Clear the search results after selection
    };

    const handleAddCastMember = (newCastMember: ActorPreview) => {
        const updatedCast = [...cast.value, newCastMember];
        setCastValue(updatedCast);
    }

    const handleCloseActorModal = () => {
        closeAddActorModal();
    }

    const handleResetFields = () => { clearAll(); };

    const hasValidationErrors = () => {
        return (
            title?.errors.length > 0 ||
            countries?.errors.length > 0 ||
            directors?.errors.length > 0 ||
            genres?.errors.length > 0 ||
            imageFiles?.errors.length > 0 ||
            languages?.errors.length > 0 ||
            letterboxdLink?.errors.length > 0 ||
            plexLink?.errors.length > 0 ||
            releaseDate?.errors.length > 0 ||
            releases?.errors.length > 0 ||
            runtime?.errors.length > 0 ||
            cast?.errors.length > 0 ||
            writers?.errors.length > 0 ||
            omdbData?.errors.length > 0 ||
            ratings?.errors.length > 0 ||
            imdbId?.errors.length > 0 ||
            certification?.errors.length > 0 ||
            plot?.errors.length > 0
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        console.log(`Has Validation Errors: ${hasValidationErrors()}`);
        // Validate the form fields before submission, if any found disallow the submission
        if (hasValidationErrors()) {
            alert('Please fix the validation errors before submitting.');
            console.log(title?.errors, countries?.errors, directors?.errors, genres?.errors, imageFiles?.errors, languages?.errors, letterboxdLink?.errors, plexLink?.errors, releaseDate?.errors, releases?.errors, runtime?.errors, cast?.errors, writers?.errors, omdbData?.errors);
            return;
        }

        const movieSubimission: Movie = {
            id: imdbId?.value || '',
            title: title?.value || '',
            countries: countries?.value || [],
            directors: directors?.value || [],
            genres: genres?.value || [],
            imageFiles: imageFiles?.value || [],
            languages: languages?.value || [],
            letterboxdLink: letterboxdLink?.value || '',
            plexLink: plexLink?.value || '',
            releaseDate: releaseDate?.value || '',
            releases: releases?.value || [],
            runtime: runtime?.value || '',
            cast: cast?.value || [],
            writers: writers?.value || [],
            omdbData: omdbData?.value || {} as OmdbResponseFull,
        };

        console.log('Movie Submission:', movieSubimission);
        await movieService.addDocument(movieSubimission).then(() => {
            const alertTitle = title?.value || 'Movie';
            alert(`Movie added successfully!: ${alertTitle}`);
            handleResetFields();
        }).catch((error) => {
            console.error(error);
        });
    };

    return (
        <React.Fragment>
            <FormControl
                onSubmit={handleSubmit}
                classes={styles.root}
                color="secondary"
                sx={{maxWidth: "100%"}}>
                <Grid
                    container
                    spacing={2}
                    sx={{maxWidth: "100%"}}>
                    <Grid size={8}>
                        <Grid container spacing={2}>
                            <MovieTitleSearch
                                title={title}
                                setTitle={setTitleValue}
                                omdbResults={omdbResults?.value}
                                handleMovieTitleSearch={handleMovieTitleSearch}
                                handleMovieSelect={handleMovieSelect}
                                />
                            <MovieDetailsInput
                                releaseDate={releaseDate}
                                setReleaseDate={setReleaseDateValue}
                                countries={countries}
                                setCountries={setCountriesValue}
                                runtime={runtime}
                                setRuntime={setRuntimeValue}
                                genres={genres}
                                setGenres={setGenresValue}
                                languages={languages}
                                setLanguages={setLanguagesValue}
                                certification={certification}
                                setCertification={setCertificationValue}
                                />
                            <Grid size={12}>
                                <FormTextField
                                    label="Plot"
                                    value={plot?.value}
                                    multiline
                                    onChange={(e) => setPlotValue(e.target.value)}
                                    error={plot?.errors.join('\n') || null} />
                            </Grid>
                            <MovieLinkInput
                                letterboxdLink={letterboxdLink}
                                setLetterboxdLink={setLetterboxdLinkValue}
                                plexLink={plexLink}
                                setPlexLink={setPlexLinkValue}
                                />
                        </Grid>
                    </Grid>
                    <Grid size={4}>
                        <Box
                            component="img"
                            src={omdbData?.value?.Poster}
                            alt={title?.value}
                            sx={{width: "100%", height: "auto"}} />
                    </Grid>
                    <RatingsInput
                        ratings={ratings}
                        setRatings={setRatingsValue} />
                    <Grid size={12}>
                        <Divider
                            sx={{color: "white"}}
                            variant="fullWidth">
                            Cast Details
                        </Divider>
                    </Grid>
                    {/* <CastInput
                        cast={cast}
                        setCast={setCastValue}
                        setShowModal={setShouldShowAddActorModal} />
                    <Grid size={0}>
                        <Divider
                            orientation="vertical"
                            variant="middle"
                            sx={{color: 'white'}} />
                    </Grid> */}
                    <Grid size={12}>
                        <CastDataGrid
                            castList={cast?.value}
                            onAddCastMember={handleAddCastMember}
                            setShowModal={openAddActorModal} />
                    </Grid>
                    <Grid size={12}>
                        <Divider
                            sx={{color: "white"}}
                            variant="fullWidth">
                            Crew Details
                        </Divider>
                    </Grid>
                        <DirectorDataGrid
                            directorList={directors?.value}
                            onAddDirector={addDirector} />
                    <Grid size={0}>
                        <Divider
                            orientation="vertical"
                            variant="middle"
                            sx={{color: 'white'}} />
                    </Grid>
                    <WritersInput
                        writers={writers}
                        setWriters={setWritersValue} />
                    {/* <MovieOptionalInput
                        dvd={dvd}
                        setDvd={setDvd}
                        production={production}
                        setProduction={setProduction}
                        totalSeasons={totalSeasons}
                        setTotalSeasons={setTotalSeasons} /> */}
                    <Grid size={12}>
                        <ImageSearch />
                    </Grid>
                    <Grid size={3}>
                        <SubmitButton
                            label="Add Movie"
                            onClick={handleSubmit}
                            disabled={!omdbData} />
                    </Grid>
                </Grid>
            </FormControl>
            {shouldShowAddDirectorModal && (
                <AddDirectorModule onClose={closeAddDirectorModal} />
            )}
            {shouldShowAddActorModal && (
                <AddActorModule onClose={handleCloseActorModal} />
            )}
        </React.Fragment>
    );
};

export default MovieForm;
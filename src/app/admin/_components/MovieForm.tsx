import React, { useEffect, useState } from 'react';
import Grid from '@mui/material/Grid';
import CatalogService from '../../../service/catalog/CatalogService';
import { FormTextField } from './formInputs/common/FormTextField';
import DirectorInput from './formInputs/DirectorInput';
import { CatalogMovie } from '../../../types/catalog/Movie.type';
import { ImageFile } from '@/types/collections/Common.type';
import { RatingEntry } from '@/types/collections/Common.type';
import { OmdbResponseFull, OmdbSearchResponse, Rating } from '../../../types/OmdbResponse.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import { retrieveMediaDataById, searchByText } from '@/service/omdb/OmdbService';
import styles from '../_styles/MovieForm.module.css';
import RatingsInput from './formInputs/RatingsInput';
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';
import CastInput from './formInputs/common/CastInput';
import WritersInput from './formInputs/WritersInput';
import MovieTitleSearch from './formInputs/movie/MovieTitleSearch';
import MovieDetailsInput from './formInputs/movie/MovieDetailsInput';
import MovieLinkInput from './formInputs/movie/MovieLinkInput';
import { prepareTitleForStorage } from '@/utils/titleUtils';
import MovieOptionalInput from './formInputs/movie/MovieOptionalInput';
import SubmitButton from '@/app/_components/SubmitButton';
import useAddMovie from '@/hooks/newMedia/useAddMovie';
import AddDirectorModule from './formInputs/modals/AddDirectorModule';
import AddActorModule from './formInputs/modals/AddActorModule';
import AddWriterModule from './formInputs/modals/AddWriterModule';
import CastDataGrid from './formInputs/common/CastDataGrid';
import { ActorPreview, MovieDirector } from '@/types/collections/Common.type';
import useFormStore from '@/store/useFormStore';
import DirectorDataGrid from './formInputs/common/DirectorDataGrid';
import { FormInputData } from '@/types/inputs/FormInput.type';


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
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
    const [mediaSubType, setMediaSubType] = useState<'live_performance' | 'home_video' | ''>('');
    const [livePerformanceYear, setLivePerformanceYear] = useState('');

    const {
        shouldShowAddActorModal,
        shouldShowAddDirectorModal,
        shouldShowAddWriterModal,
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
        validateAllFields,
        clearAll,
    } = useAddMovie();

    const movieService = new CatalogService('movies');

    useEffect(() => {
        if (!omdbData?.value) {
            return;
        }

        // Format certain fields in the OMDB data and set the form fields accordingly
        const formattedReleaseDate = omdbData.value.Released.split(' ').join('-') || '';
        const runtimeInMinutes = omdbData.value.Runtime.split(" ")[0];
        const formattedRuntime = `${Math.floor(Number(runtimeInMinutes) / 60)}:${Number(runtimeInMinutes) % 60}:00`;
        

        setTitleValue(omdbData.value.Title || '');
        setLetterboxdLinkValue(omdbData.value.Website || '');
        setReleaseDateValue(formattedReleaseDate || '');
        setRuntimeValue(formattedRuntime || '');
        setImdbIdValue(omdbData.value.imdbID || '');
        setCertificationValue(omdbData.value.Rated || '');
        setPlotValue(omdbData.value.Plot || '');
        setCountriesValue(
            omdbData.value.Country
            .split(',')
            .map((country: string) => 
                country.trim()
            ) || []
        );
        setDirectorsValue(
            omdbData.value.Director
            .split(',')
            .map((director: string) => (
                {name: director || '', title: '', directorId: ''} as MovieDirector
            )).concat(directors?.value) || []
        );
        if (omdbData.value.Poster) {setImageFilesValue(
            [...imageFiles.value,
                { fileName: omdbData.value.Poster || '', fileSize: '0', resolution: '', format: 'jpg' } as ImageFile
            ])
        };
        setCastValue(omdbData.value.Actors.split(',').map((actorName: string) => ({ name: actorName, characters: [], actorId: '' })) || []);
        setWritersValue(omdbData.value.Writer.split(',').map((writer: string) => writer.trim()) || []);
        setGenresValue(omdbData.value.Genre.split(',').map((genre: string) => genre.trim()) || []);
        setLanguagesValue(omdbData.value.Language.split(',').map((language: string) => language.trim()) || []);
        setRatingsValue(omdbData.value.Ratings.map((ratingData: Rating) => ({source: ratingData.Source, value: ratingData.Value})) || []);
    }, [omdbData]);

    const handleMovieTitleSearch = async (title: string) => {
        try {
            const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
            setOmdbResultsValue(omdbSearchResults);
        } catch (error) {
            console.error('Movie title search failed:', error);
            setOmdbResultsValue([]);
            alert(error instanceof Error ? error.message : 'Movie title search failed.');
        }
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
        const movieService = new CatalogService('movies');
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

    const handleResetFields = () => {
        clearAll();
        setHasAttemptedSubmit(false);
        setMediaSubType('');
        setLivePerformanceYear('');
    };

    const associateMovieToPeople = async (movieId: string) => {
        const actorService = new CatalogService('actors');
        const directorService = new CatalogService('directors');
        const writerService = new CatalogService('writers');

        const appendMovieAssociation = async (service: CatalogService, personId: string) => {
            if (!personId) {
                return;
            }
            const existingDoc = await service.getDocumentById(personId);
            if (!existingDoc) {
                return;
            }
            const existingMovieIds = Array.isArray(existingDoc.movieIds) ? existingDoc.movieIds : [];
            const movieIds = Array.from(new Set([...existingMovieIds, movieId]));
            await service.updateDocument(personId, { movieIds });
        };

        for (const director of directors.value) {
            await appendMovieAssociation(directorService, director.directorId);
        }

        for (const actor of cast.value) {
            await appendMovieAssociation(actorService, actor.actorId);
        }

        for (const writerName of writers.value) {
            const trimmedName = writerName.trim();
            if (!trimmedName) {
                continue;
            }

            const matchingWriters = await writerService.getDocumentsByField('fullName', trimmedName);
            if (matchingWriters.length > 0) {
                const writerDoc = matchingWriters[0];
                const existingMovieIds = Array.isArray(writerDoc.movieIds) ? writerDoc.movieIds : [];
                const movieIds = Array.from(new Set([...existingMovieIds, movieId]));
                await writerService.updateDocument(writerDoc.id, { movieIds });
                continue;
            }

            await writerService.addDocument({
                fullName: trimmedName,
                movieIds: [movieId],
                seriesIds: [],
                birthplace: '',
                birthday: '',
                notes: '',
            });
        }
    };

    const getDisplayField = <T,>(field: FormInputData<T>): FormInputData<T> => {
        if (hasAttemptedSubmit) {
            return field;
        }
        return { ...field, errors: [] };
    };

    const titleForDisplay = getDisplayField(title);
    const releaseDateForDisplay = getDisplayField(releaseDate);
    const countriesForDisplay = getDisplayField(countries);
    const runtimeForDisplay = getDisplayField(runtime);
    const genresForDisplay = getDisplayField(genres);
    const languagesForDisplay = getDisplayField(languages);
    const certificationForDisplay = getDisplayField(certification);
    const plotForDisplay = getDisplayField(plot);
    const letterboxdLinkForDisplay = getDisplayField(letterboxdLink);
    const plexLinkForDisplay = getDisplayField(plexLink);
    const writersForDisplay = getDisplayField(writers);

    const handleLivePerformanceSubmit = async () => {
        const titleValue = title?.value?.trim();
        if (!titleValue) {
            alert('Please enter a title.');
            return;
        }
        const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `live-${Date.now()}`;
        const yearStr = livePerformanceYear.trim();
        const submission: CatalogMovie = {
            id,
            ...prepareTitleForStorage(titleValue),
            countryOfOrigin: [],
            directors: [],
            genres: [],
            imageFiles: [],
            languages: [],
            letterboxdLink: '',
            plexLink: '',
            releaseDate: yearStr ? `01 Jan ${yearStr}` : '',
            releaseIds: [],
            runtime: '',
            topCast: [],
            writers: [],
            isPartOfCollection: false,
            externalIds: {},
            plot: '',
            certification: '',
            imdbRating: '',
            mediaSubType: 'live_performance',
        } as unknown as CatalogMovie;
        await movieService.addDocument(submission).then(() => {
            alert(`Live performance added successfully: ${titleValue}`);
            handleResetFields();
        }).catch((error) => {
            console.error(error);
            alert('Failed to add live performance entry.');
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setHasAttemptedSubmit(true);

        const hasErrors = validateAllFields();
        console.log(`Has Validation Errors: ${hasErrors}`);
        // Validate the form fields before submission, if any found disallow the submission
        if (hasErrors) {
            alert('Please fix the validation errors before submitting.');
            console.log(title?.errors, countries?.errors, directors?.errors, genres?.errors, imageFiles?.errors, languages?.errors, letterboxdLink?.errors, plexLink?.errors, releaseDate?.errors, releases?.errors, runtime?.errors, cast?.errors, writers?.errors, omdbData?.errors);
            return;
        }

        const normalizeImageFiles = (files: any[]) => {
            return files.map(f => ({
                fileName: f.fileName || '',
                fileSize: typeof f.fileSize === 'string' ? parseInt(f.fileSize) || 0 : (f.fileSize || 0),
                resolution: f.resolution || '',
                format: f.format || ''
            }));
        };

        const movieSubimission: CatalogMovie = {
            id: imdbId?.value || '',
            ...prepareTitleForStorage(title?.value || ''),
            countryOfOrigin: countries?.value || [],
            directors: (directors?.value || []).map(d => ({
                fullName: d.name || '',
                title: d.title || '',
                directorId: d.directorId || ''
            })),
            genres: genres?.value || [],
            imageFiles: normalizeImageFiles(imageFiles?.value || []),
            languages: languages?.value || [],
            letterboxdLink: letterboxdLink?.value || '',
            plexLink: plexLink?.value || '',
            releaseDate: releaseDate?.value || '',
            releaseIds: releases?.value?.map((r: any) => r.id || '') || [],
            runtime: runtime?.value || '',
            topCast: (cast?.value || []).map(c => ({
                actorName: c.name || '',
                characterName: c.characters?.[0] || '',
                actorId: c.actorId || ''
            })),
            writers: writers?.value || [],
            isPartOfCollection: false,
            externalIds: {
                imdbId: imdbId?.value || omdbData?.value?.imdbID
            },
            imdbId: imdbId?.value || omdbData?.value?.imdbID,
            plot: plot?.value || '',
            certification: certification?.value || '',
            imdbRating: omdbData?.value?.imdbRating || '',
            ...(mediaSubType ? { mediaSubType } : {}),
        };

        console.log('Movie Submission:', movieSubimission);
        await movieService.addDocument(movieSubimission).then(() => {
            if (movieSubimission.id) {
                void associateMovieToPeople(movieSubimission.id);
            }
            const alertTitle = title?.value || 'Movie';
            alert(`Movie added successfully!: ${alertTitle}`);
            handleResetFields();
        }).catch((error) => {
            console.error(error);
        });
    };

    return (
        <React.Fragment>
            <Box
                component="form"
                onSubmit={handleSubmit}
                className={styles.root}
                sx={{maxWidth: "100%"}}>
                <Grid
                    container
                    spacing={2}
                    sx={{maxWidth: "100%"}}>
                    <Grid size={12}>
                        <FormSectionStack>
                            <FormSection title="Classification" description="Select the movie subtype before filling in the form." titleTooltip="Determines which fields are required and how the entry is categorised in your library.">
                                <Grid container spacing={2}>
                                    <Grid size={12}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel id="movie-subtype-label">Subtype</InputLabel>
                                            <Select
                                                labelId="movie-subtype-label"
                                                label="Subtype"
                                                value={mediaSubType}
                                                onChange={(e) => {
                                                    const next = e.target.value as 'live_performance' | 'home_video' | '';
                                                    clearAll();
                                                    setHasAttemptedSubmit(false);
                                                    setLivePerformanceYear('');
                                                    setMediaSubType(next);
                                                }}
                                            >
                                                <MenuItem value="">None (Standard Movie)</MenuItem>
                                                <MenuItem value="live_performance">Live Performance</MenuItem>
                                                <MenuItem value="home_video">Home Video</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                </Grid>
                            </FormSection>

                            {mediaSubType === 'live_performance' ? (
                                <FormSection title="Live Performance Details" description="Enter the title and year for this live performance entry." titleTooltip="A minimal entry will be created with the title and year. All other fields will use default values.">
                                    <Grid container spacing={2}>
                                        <Grid size={12}>
                                            <Typography variant="h4" color="white">
                                                Add Live Performance
                                            </Typography>
                                        </Grid>
                                        <Grid size={8}>
                                            <FormTextField
                                                label="Title"
                                                value={title?.value || ''}
                                                onChange={(e) => setTitleValue(e.target.value)}
                                                error={hasAttemptedSubmit ? (title?.errors.join('\n') || null) : null}
                                            />
                                        </Grid>
                                        <Grid size={4}>
                                            <FormTextField
                                                label="Year"
                                                value={livePerformanceYear}
                                                onChange={(e) => setLivePerformanceYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                                error={null}
                                            />
                                        </Grid>
                                    </Grid>
                                </FormSection>
                            ) : (
                                <>
                                    <FormSection title="Search and Import" description="Search OMDB to auto-fill the form, then review and modify as needed." titleTooltip="Import baseline metadata from OMDB, then correct anything that needs project-specific curation.">
                                        <Grid container spacing={2}>
                                            <Grid size={omdbData?.value?.Poster ? 8 : 12}>
                                                <MovieTitleSearch
                                                    title={titleForDisplay}
                                                    setTitle={setTitleValue}
                                                    omdbResults={omdbResults?.value}
                                                    handleMovieTitleSearch={handleMovieTitleSearch}
                                                    handleMovieSelect={handleMovieSelect}
                                                    />
                                            </Grid>
                                            {omdbData?.value?.Poster && (
                                                <Grid size={4}>
                                                    <Box
                                                        component="img"
                                                        src={omdbData.value.Poster}
                                                        alt={title?.value}
                                                        sx={{width: "100%", height: "auto", borderRadius: 1}} />
                                                </Grid>
                                            )}
                                        </Grid>
                                    </FormSection>

                                    <FormSection title="Core Details" description="Movie release details and description." titleTooltip="Capture release date, runtime, countries, language, genres, rating, and synopsis.">
                                        <Grid container spacing={2}>
                                            <MovieDetailsInput
                                                releaseDate={releaseDateForDisplay}
                                                setReleaseDate={setReleaseDateValue}
                                                countries={countriesForDisplay}
                                                setCountries={setCountriesValue}
                                                runtime={runtimeForDisplay}
                                                setRuntime={setRuntimeValue}
                                                genres={genresForDisplay}
                                                setGenres={setGenresValue}
                                                languages={languagesForDisplay}
                                                setLanguages={setLanguagesValue}
                                                certification={certificationForDisplay}
                                                setCertification={setCertificationValue}
                                                />
                                            <Grid size={12}>
                                                <FormTextField
                                                    label={<FieldLabel label="Plot" tooltip="A short synopsis of the movie. One to three sentences is usually enough." />}
                                                    value={plot?.value}
                                                    multiline
                                                    onChange={(e) => setPlotValue(e.target.value)}
                                                    error={plotForDisplay?.errors.join('\n') || null} />
                                            </Grid>
                                        </Grid>
                                    </FormSection>

                                    <FormSection title="Credits" description="Directors, cast and writers." titleTooltip="Record principal creative credits and cast members shown in detail pages and metadata exports.">
                                        <DirectorDataGrid
                                            directorList={directors?.value}
                                            onAddDirector={addDirector} />
                                        <CastDataGrid
                                            castList={cast?.value}
                                            onAddCastMember={handleAddCastMember}
                                            setShowModal={openAddActorModal} />
                                        <WritersInput
                                            writers={writersForDisplay}
                                            setWriters={setWritersValue} />
                                    </FormSection>

                                    <FormSection title="Ratings" description="Ratings and content certification." titleTooltip="Capture content ratings and certification data used for sorting, filtering, and parental guidance.">
                                        <Grid container spacing={2}>
                                            <RatingsInput
                                                ratings={ratings}
                                                setRatings={setRatingsValue} />
                                        </Grid>
                                    </FormSection>

                                    <FormSection title="Links and Media" description="External links and poster artwork." titleTooltip="Store optional destination links and artwork references associated with this movie.">
                                        <MovieLinkInput
                                            letterboxdLink={letterboxdLinkForDisplay}
                                            setLetterboxdLink={setLetterboxdLinkValue}
                                            plexLink={plexLinkForDisplay}
                                            setPlexLink={setPlexLinkValue}
                                            />
                                        <ImageSearch />
                                    </FormSection>
                                </>
                            )}
                        </FormSectionStack>
                    </Grid>
                    <Grid size={3}>
                        {mediaSubType === 'live_performance' ? (
                            <SubmitButton
                                label="Add Live Performance"
                                onClick={handleLivePerformanceSubmit}
                                disabled={!title?.value?.trim()} />
                        ) : (
                            <SubmitButton
                                label="Add Movie"
                                onClick={handleSubmit}
                                disabled={!omdbData?.value} />
                        )}
                    </Grid>
                </Grid>
            </Box>
            {shouldShowAddDirectorModal && (
                <AddDirectorModule onClose={closeAddDirectorModal} />
            )}
            {shouldShowAddActorModal && (
                <AddActorModule onClose={handleCloseActorModal} />
            )}
            {shouldShowAddWriterModal && (
                <AddWriterModule />
            )}
        </React.Fragment>
    );
};

export default MovieForm;
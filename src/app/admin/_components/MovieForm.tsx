import React, { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import FirestoreService from '../../../service/FirestoreService';
import FormControl from '@mui/material/FormControl';
import FormTextField from './formInputs/FormTextField';
import DirectorInput from './formInputs/DirectorInput';
import { FBMovie, Director, ImageFile } from '../../../types/firebase/FBMovie.type';
import { OmdbResponseFull, OmdbSearchResponse, Rating } from '../../../types/OmdbResponse.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import { retrieveMediaDataById, searchByText } from '../../../service/OmdbService';
import styles from '../_styles/MovieForm.module.css';
import useMovieValidation from '../../../utils/useMovieValidation';
import RatingsInput from './formInputs/RatingsInput';
import { Box } from '@mui/material';
import TopCastInput from './formInputs/TopCastInput';
import { TopCastEntry } from '@/types/inputs/MovieInputs';
import WritersInput from './formInputs/WritersInput';
import MovieTitleSearch from './formInputs/movie/MovieTitleSearch';
import MovieDetailsInput from './formInputs/movie/MovieDetailsInput';
import MovieLinkInput from './formInputs/movie/MovieLinkInput';
import MovieOptionalInput from './formInputs/movie/MovieOptionalInput';
import SubmitButton from '@/app/_components/SubmitButton';


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
    const [title, setTitle] = useState('');
    const [year, setYear] = useState('');
    const [countryOfOrigin, setCountryOfOrigin] = useState('');
    const [directors, setDirectors] = useState<Director[]>([]);
    const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
    const [letterboxdLink, setLetterboxdLink] = useState('');
    const [plexLink, setPlexLink] = useState('');
    const [omdbData, setOmdbData] = useState<OmdbResponseFull | null>(null);
    const [omdbResults, setOmdbResults] = useState<OmdbSearchResponse[]>([]);
    const [releaseDate, setReleaseDate] = useState('');
    const [releases, setReleases] = useState<string[]>([]);
    const [ratings, setRatings] = useState<Rating[]>([]);
    const [runtime, setRuntime] = useState('');
    const [writers, setWriters] = useState<string[]>([]);
    const [isPartOfCollection, setIsPartOfCollection] = useState(false);
    const [genres, setGenres] = useState<string[]>([]);
    const [language, setLanguage] = useState('');
    const [imdbId, setImdbId] = useState('');
    const [rated, setRated] = useState('');
    const [plot, setPlot] = useState('');
    const [awards, setAwards] = useState('');
    const [metascore, setMetascore] = useState('');
    const [imdbRating, setImdbRating] = useState('');
    const [imdbVotes, setImdbVotes] = useState('');
    const [dvd, setDvd] = useState('');
    const [boxOffice, setBoxOffice] = useState('');
    const [production, setProduction] = useState('');
    const [totalSeasons, setTotalSeasons] = useState('');
    const [topCast, setTopCast] = useState<TopCastEntry[]>([]);

    const { 
        validateTitle,
        validateYear,
        validateCountryOfOrigin,
        validateDirectors,
        validateImageFiles,
        validateReleaseDate,
        validateRuntime,
        validateTopCast,
        validateWriters,
        validateGenres,
        validateLanguage,
        validateRated,
        validatePlot,
        validateAwards,
        validateMetascore,
        validateImdbRating,
        validateImdbVotes,
    } = useMovieValidation();

    const [errors, setErrors] = useState<ValidationErrors>({
        title: null,
        year: null,
        countryOfOrigin: null,
        directors: null,
        imageFiles: null,
        releaseDate: null,
        runtime: null,
        topCast: null,
        writers: null,
        genres: null,
        language: null,
        rated: null,
        plot: null,
        awards: null,
        metascore: null,
        imdbRating: null,
        imdbVotes: null,
    });

    useEffect(() => {
        setTitle(omdbData?.Title || title);
        setYear(omdbData?.Year || year);
        setCountryOfOrigin(omdbData?.Country || countryOfOrigin);
        setDirectors(omdbData?.Director.split(',').map((director: string) => ({ name: director, title: '' })).concat(directors) || directors);
        if (omdbData?.Poster) { setImageFiles([...imageFiles, { fileName: omdbData?.Poster || '', fileSize: 0, resolution: '', format: '' }])};
        setLetterboxdLink(omdbData?.Website || letterboxdLink);
        setReleaseDate(omdbData?.Released || releaseDate);
        setRuntime(omdbData?.Runtime || runtime);
        setTopCast(omdbData?.Actors.split(',').map((actor: string) => ({ actor: actor, characters: [] })) || topCast);
        setWriters(omdbData?.Writer.split(',').map((writer: string) => writer.trim()) || writers);
        setGenres(omdbData?.Genre.split(',').map((genre: string) => genre.trim()) || genres);
        setLanguage(omdbData?.Language || language);
        setImdbId(omdbData?.imdbID || imdbId);
        setRated(omdbData?.Rated || rated);
        setRatings(omdbData?.Ratings || ratings);
        setPlot(omdbData?.Plot || plot);
        setAwards(omdbData?.Awards || awards);
        setMetascore(omdbData?.Metascore || metascore);
        setImdbRating(omdbData?.imdbRating || imdbRating);
        setImdbVotes(omdbData?.imdbVotes || imdbVotes);
        setDvd(omdbData?.Dvd || dvd);
        setBoxOffice(omdbData?.BoxOffice || boxOffice);
        setProduction(omdbData?.Production || production);
        setTotalSeasons(omdbData?.TotalSeasons || totalSeasons);
    }, [omdbData]);

    const handleMovieTitleSearch = async (title: string) => {
        const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
        setOmdbResults(omdbSearchResults);
    };

    const handleAddDirector = () => {
        setDirectors([...directors, { name: '', title: '' }]);
    };

    const handleSetRatings = (ratings: Rating[]) => {
        setRatings(ratings);
    };

    const handleDirectorChange = (index: number, field: keyof Director, value: string) => {
        const newDirectors = [...directors];
        newDirectors[index][field] = value;
        setDirectors(newDirectors);
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
        
        setTitle(selectedTitle);
        setYear(selectedYear);
        const fullMovieData = await retrieveMediaDataById(selectedImdbId)
        handleResetFields();
        setOmdbData(null);
        setOmdbData(fullMovieData);
        setOmdbResults([]); // Clear the search results after selection
    };

    const handleResetFields = () => {
        setTitle('');
        setYear('');
        setCountryOfOrigin('');
        setDirectors([]);
        setImageFiles([]);
        setLetterboxdLink('');
        setPlexLink('');
        setOmdbData(null);
        setOmdbResults([]);
        setReleaseDate('');
        setReleases([]);
        setRatings([]);
        setRuntime('');
        setWriters([]);
        setIsPartOfCollection(false);
        setGenres([]);
        setLanguage('');
        setImdbId('');
        setRated('');
        setPlot('');
        setAwards('');
        setMetascore('');
        setImdbRating('');
        setImdbVotes('');
        setDvd('');
        setBoxOffice('');
        setProduction('');
        setTotalSeasons('');
        setTopCast([]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const newErrors = {
            title: validateTitle(title),
            year: validateYear(year),
            countryOfOrigin: validateCountryOfOrigin(countryOfOrigin),
            directors: validateDirectors(directors),
            imageFiles: validateImageFiles(imageFiles),
            releaseDate: validateReleaseDate(releaseDate),
            runtime: validateRuntime(runtime),
            topCast: validateTopCast(topCast),
            writers: validateWriters(writers),
            genres: validateGenres(genres),
            language: validateLanguage(language),
            rated: validateRated(rated),
            plot: validatePlot(plot),
            awards: validateAwards(awards),
            metascore: validateMetascore(metascore),
            imdbRating: validateImdbRating(imdbRating),
            imdbVotes: validateImdbVotes(imdbVotes),
        };

        setErrors(newErrors);

        const hasErrors = Object.values(newErrors).some(error => error !== null);
        if (hasErrors) {
            return;
        }

        const movie: FBMovie = {
            id: '', // Firebase will generate the ID
            title,
            countryOfOrigin,
            directors,
            imageFiles,
            letterboxdLink,
            plexLink,
            omdbData: omdbData!,
            releaseDate,
            releases: [], // Assuming releases are an array of release IDs
            runtime,
            topCast,
            writers,
            isPartOfCollection,
            genres,
            language,
        };

        const service = new FirestoreService('movies');
        await service.addDocument(movie).then(() => {
            handleResetFields();
            setOmdbData(null);
        }).catch((error) => {
            console.error(error);
        });
    };

    return (
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
                            setTitle={setTitle}
                            errors={errors}
                            omdbResults={omdbResults}
                            handleMovieTitleSearch={handleMovieTitleSearch}
                            handleMovieSelect={handleMovieSelect}
                            />
                        <MovieDetailsInput
                            year={year}
                            setYear={setYear}
                            releaseDate={releaseDate}
                            setReleaseDate={setReleaseDate}
                            countryOfOrigin={countryOfOrigin}
                            setCountryOfOrigin={setCountryOfOrigin}
                            runtime={runtime}
                            setRuntime={setRuntime}
                            genres={genres}
                            setGenres={setGenres}
                            language={language}
                            setLanguage={setLanguage}
                            boxOffice={boxOffice}
                            setBoxOffice={setBoxOffice}
                            rated={rated}
                            setRated={setRated}
                            awards={awards}
                            setAwards={setAwards}
                            errors={errors}
                            />
                        <Grid size={12}>
                            <FormTextField
                                label="Plot"
                                value={plot}
                                multiline
                                onChange={(e) => setPlot(e.target.value)}
                                error={errors.plot} />
                        </Grid>
                        <MovieLinkInput
                            letterboxdLink={letterboxdLink}
                            setLetterboxdLink={setLetterboxdLink}
                            plexLink={plexLink}
                            setPlexLink={setPlexLink}
                            />
                    </Grid>
                </Grid>
                <Grid size={4}>
                    <Box
                        component="img"
                        src={omdbData?.Poster}
                        alt={title}
                        sx={{width: "100%", height: "auto"}} />
                </Grid>
                <RatingsInput
                    ratings={ratings}
                    numberOfImdbVoters={imdbVotes}
                    setRatings={setRatings} />
                <Grid size={12}>
                    <Divider
                        sx={{color: "white"}}
                        variant="fullWidth">
                        Crew Details
                    </Divider>
                </Grid>
                <TopCastInput
                    topCast={topCast}
                    setTopCast={setTopCast}
                    error={errors.topCast} />
                <Grid size={0}>
                    <Divider
                        orientation="vertical"
                        variant="middle"
                        sx={{color: 'white'}} />
                </Grid>
                <DirectorInput
                    directors={directors}
                    handleDirectorChange={handleDirectorChange}
                    handleAddDirector={handleAddDirector} />
                <Grid size={0}>
                    <Divider
                        orientation="vertical"
                        variant="middle"
                        sx={{color: 'white'}} />
                </Grid>
                <WritersInput
                    writers={writers}
                    setWriters={setWriters}
                    error={errors.writers} />
                <MovieOptionalInput
                    dvd={dvd}
                    setDvd={setDvd}
                    production={production}
                    setProduction={setProduction}
                    totalSeasons={totalSeasons}
                    setTotalSeasons={setTotalSeasons} />
                <Grid size={3}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={isPartOfCollection}
                                onChange={(e) => setIsPartOfCollection(e.target.checked)}
                            />
                        }
                        label="Is Part of Collection"
                    />
                </Grid>
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
    );
};

export default MovieForm;
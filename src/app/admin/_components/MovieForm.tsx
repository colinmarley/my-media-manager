import React, { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid2';
import FirestoreService from '../../../service/FirestoreService';
import FormControl from '@mui/material/FormControl';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import TextField from '@mui/material/TextField';
import { FBMovie, Director, ImageFile } from '../../../types/firebase/FBMovie.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import { retrieveMediaDataById, searchByText } from '../../../service/OmdbService';
import styles from '../_styles/MovieForm.module.css';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

const FormTextField = (
    props: { 
        label: string,
        value: string,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    }) => (
        <TextField
            label={props.label}
            value={props.value}
            onChange={props.onChange}
            sx={{input: { color: 'white' }, label: { color: 'white' }}}
            fullWidth
            required
        />
);

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
    const [runtime, setRuntime] = useState('');
    const [topCast, setTopCast] = useState<string[]>([]);
    const [writers, setWriters] = useState<string[]>([]);
    const [isPartOfCollection, setIsPartOfCollection] = useState(false);
    const [genres, setGenres] = useState<string[]>([]);
    const [language, setLanguage] = useState('');

    useEffect(() => {
        setTitle(omdbData?.Title || title);
        setYear(omdbData?.Year || year);
        setCountryOfOrigin(omdbData?.Country || countryOfOrigin);
        setDirectors(omdbData?.Director.split(',').map((director: string) => ({ name: director, title: '' })).concat(directors) || directors);
        if (omdbData?.Poster) { setImageFiles([...imageFiles, { fileName: omdbData?.Poster || '', fileSize: 0, resolution: '', format: '' }])};
        setLetterboxdLink(omdbData?.Website || letterboxdLink);
        setReleaseDate(omdbData?.Released || releaseDate);
        setRuntime(omdbData?.Runtime || runtime);
        setTopCast(omdbData?.Actors.split(',').map((actor: string) => actor.trim()) || topCast);
        setWriters(omdbData?.Writer.split(',').map((writer: string) => writer.trim()) || writers);
        setGenres(omdbData?.Genre.split(',').map((genre: string) => genre.trim()) || genres);
        setLanguage(omdbData?.Language || language);
    }, [omdbData]);

    const handleMovieTitleSearch = async (title: string) => {
        const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
        setOmdbResults(omdbSearchResults);
    };

    const handleAddDirector = () => {
        setDirectors([...directors, { name: '', title: '' }]);
    };

    const handleDirectorChange = (index: number, field: keyof Director, value: string) => {
        const newDirectors = [...directors];
        newDirectors[index][field] = value;
        setDirectors(newDirectors);
    };

    const handleMovieSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) =>{
        setTitle(selectedTitle);
        setYear(selectedYear);
        const fullMovieData = await retrieveMediaDataById(selectedImdbId)
        setOmdbData(fullMovieData);
        setOmdbResults([]); // Clear the search results after selection
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

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
        await service.addDocument(movie);
    };

    return (
        <FormControl
            onSubmit={handleSubmit}
            classes={styles.root}
            color="secondary">
            <Grid container spacing={2}>
                <Grid size={12}>
                    <Typography variant="h4" color="white">Add New Movie</Typography>
                </Grid>
                <Grid size={9}>
                <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </Grid>
                <Grid size={12}>
                    <Button onClick={() => handleMovieTitleSearch(title)} variant="contained" color="primary">
                        Search Movie Title
                    </Button>
                </Grid>
                    {omdbResults.length > 0 && (
                        <Grid size={12}>
                            <Typography variant="h6">Search Results:</Typography>
                            <List>
                            {omdbResults.map((result, index) => (
                                <ListItem key={`search-result-${index}`} disablePadding>
                                    <ListItemButton onClick={() => handleMovieSelect(result.Title, result.Year, result.imdbID)}>
                                        <ListItemText primary={`${result.Title} (${result.Year})`} />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                            </List>
                        </Grid>
                    )}
                <Grid size={12} color={"white"}>
                    <FormTextField label="Year" value={year} onChange={(e) => setYear(e.target.value)} />
                </Grid>
                <Grid size={3} color={"white"}>
                    <FormTextField label="Country of Origin" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} />
                </Grid>
                <Grid size={12}>
                    <Typography variant="h6">Directors</Typography>
                    {directors.map((director, index) => (
                        <Grid container spacing={2} key={index}>
                        <Grid size={6}>
                            <FormTextField label="Name" value={director.name} onChange={(e) => handleDirectorChange(index, 'name', e.target.value)} />
                        </Grid>
                        <Grid size={6}>
                            <FormTextField label="Title" value={director.title} onChange={(e) => handleDirectorChange(index, 'title', e.target.value)} />
                        </Grid>
                        </Grid>
                    ))}
                    <Button onClick={handleAddDirector}>Add Director</Button>
                </Grid>
                <Grid size={6}>
                    <FormTextField label="Letterboxd Link" value={letterboxdLink} onChange={(e) => setLetterboxdLink(e.target.value)} />
                </Grid>
                <Grid size={6}>
                    <FormTextField label="Plex Link" value={plexLink} onChange={(e) => setPlexLink(e.target.value)} />
                </Grid>
                <Grid size={3}>
                    <FormTextField label="Release Date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
                </Grid>
                <Grid size={3}>
                    <FormTextField label="Runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
                </Grid>
                <Grid size={6}>
                    <FormTextField label="Top Cast" value={topCast.join(', ')} onChange={(e) => setTopCast(e.target.value.split(', '))} />
                </Grid>
                <Grid size={6}>
                    <FormTextField label="Writers" value={writers.join(', ')} onChange={(e) => setWriters(e.target.value.split(', '))} />
                </Grid>
                <Grid size={6}>
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
                <Grid size={4}>
                    <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} />
                </Grid>
                <Grid size={8}>
                    <FormTextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </Grid>
                <Grid size={12}>
                    <ImageSearch />
                </Grid>
                <Grid size={3}>
                    <Button type="submit" variant="contained" color="primary" onClick={handleSubmit} disabled={!omdbData}>
                        Add Movie
                    </Button>
                </Grid>
                    {omdbData && (
                        <Grid size={12}>
                            <Typography variant="body1">OMDB Data: {JSON.stringify(omdbData)}</Typography>
                        </Grid>
                    )}
            </Grid>
        </FormControl>
    );
};

export default MovieForm;
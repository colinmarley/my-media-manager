'use client';

import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid2';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import CardContent from '@mui/material/CardContent';
import Badge from '@mui/material/Badge';
import Modal from '@mui/material/Modal';
import Button from '@mui/material/Button';
import { FBMovie } from '@/types/firebase/FBMovie.type';
import { FBSeries } from '@/types/firebase/FBSeries.type';

import useMovies from '../../../../hooks/firebase/useMovies';
import useSeries from '../../../../hooks/firebase/useSeries';

const LibraryPage = () => {
    const [mediaCollection, setMediaCollection] = useState<(FBMovie | FBSeries)[]>([]);
    const [selectedMedia, setSelectedMedia] = useState<FBMovie | FBSeries | null>(null);
    const { series, loading, error } = useSeries();
    const { movies } = useMovies();

    useEffect(() => {
        console.log('Series:', series);
        console.log('Movies:', movies);
        console.log(series.keys());
        console.log(movies.keys());
        const combinedCollection = [...series, ...movies];
        console.log('Combined Collection:', combinedCollection);
        setMediaCollection(combinedCollection);
    }, [series, movies]);

    const handleTileClick = (media: FBMovie | FBSeries) => {
        setSelectedMedia(media);
    };

    const handleCloseModal = () => {
        setSelectedMedia(null);
    };

    // Type guard function
    const isSeries = (media: FBMovie | FBSeries): media is FBSeries => {
        return (media as FBSeries).seasons !== undefined;
    };

    return (
        <Box sx={Styles.page}>
        <Typography variant="h4" sx={Styles.title}>
            My Media Collection
        </Typography>
        <Grid container spacing={2} sx={Styles.grid}>
            {mediaCollection.length && mediaCollection.map((media) => {
                console.log('Media:', media);
                console.log('media.omdbData:', media.omdbData);
                console.log('media.imdbID:', media?.imdbID);
                return (
                    <Grid
                        size={{ xs: 12, sm: 6, md: 4, lg: 3 }}
                        key={isSeries(media) ? media.imdbID : media.omdbData.imdbID}>
                        <Card sx={Styles.card} onClick={() => handleTileClick(media)}>
                        <Badge
                            badgeContent={isSeries(media) ? 'Series' : 'Movie'}
                            color="primary"
                            sx={Styles.badge}
                        >
                            <CardMedia
                            component="img"
                            height="300"
                            image={media?.omdbData?.Poster}
                            alt={media.title}
                            sx={Styles.poster}
                            />
                        </Badge>
                        <CardContent>
                            <Typography variant="h6" sx={Styles.cardTitle}>
                            {media.title}
                            </Typography>
                            <Typography variant="body2" sx={Styles.cardSubtitle}>
                            {isSeries(media)
                                ? media?.runningDates?.toString() || 'N/A'
                                : media?.releaseDate?.toString() || 'N/A'}
                            </Typography>
                        </CardContent>
                        </Card>
                    </Grid>
                )
            })}
        </Grid>

        {/* Modal for Selected Media */}
        <Modal open={!!selectedMedia} onClose={handleCloseModal}>
            <Box sx={Styles.modal}>
            {selectedMedia && (
                <>
                <CardMedia
                    component="img"
                    height="400"
                    image={selectedMedia.omdbData.Poster}
                    alt={selectedMedia.title}
                    sx={Styles.modalPoster}
                />
                <Typography variant="h5" sx={Styles.modalTitle}>
                    {selectedMedia.title}
                </Typography>
                <Typography variant="body1" sx={Styles.modalSubtitle}>
                    {isSeries(selectedMedia) 
                        ? selectedMedia?.runningDates?.toString() 
                        : selectedMedia?.releaseDate?.toString()}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Country:</strong> {selectedMedia.countryOfOrigin}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Directors:</strong> {selectedMedia.directors.map((d) => d.name).join(', ')}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Runtime:</strong> {selectedMedia.runtime.toString()}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Genres:</strong> {selectedMedia.genres?.join(', ')}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Top Cast:</strong> {selectedMedia.topCast.join(', ')}
                </Typography>
                <Typography variant="body2" sx={Styles.modalText}>
                    <strong>Writers:</strong> {selectedMedia.writers.join(', ')}
                </Typography>
                {selectedMedia.plexLink && (
                    <Button href={selectedMedia.plexLink} target="_blank" sx={Styles.modalButton}>
                    View on Plex
                    </Button>
                )}
                {selectedMedia.letterboxdLink && (
                    <Button href={selectedMedia.letterboxdLink} target="_blank" sx={Styles.modalButton}>
                    View on Letterboxd
                    </Button>
                )}
                </>
            )}
            </Box>
        </Modal>
        </Box>
    );
    };

    const Styles = {
    page: {
        padding: '20px',
        backgroundColor: '#121212',
        color: '#ffffff',
        minHeight: '100vh',
    },
    title: {
        marginBottom: '20px',
        textAlign: 'center',
    },
    grid: {
        display: 'flex',
        justifyContent: 'center',
    },
    card: {
        cursor: 'pointer',
        backgroundColor: '#1e1e1e',
        color: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.3)',
        '&:hover': {
        boxShadow: '0px 6px 10px rgba(0, 0, 0, 0.5)',
        },
    },
    badge: {
        position: 'absolute',
        top: '10px',
        left: '10px',
    },
    poster: {
        borderRadius: '8px 8px 0 0',
    },
    cardTitle: {
        fontWeight: 'bold',
    },
    cardSubtitle: {
        color: '#aaaaaa',
    },
    modal: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80%',
        maxWidth: '600px',
        backgroundColor: '#1e1e1e',
        color: '#ffffff',
        borderRadius: '8px',
        padding: '20px',
        boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.3)',
    },
    modalPoster: {
        borderRadius: '8px',
        marginBottom: '20px',
    },
    modalTitle: {
        fontWeight: 'bold',
        marginBottom: '10px',
    },
    modalSubtitle: {
        color: '#aaaaaa',
        marginBottom: '20px',
    },
    modalText: {
        marginBottom: '10px',
    },
    modalButton: {
        marginTop: '10px',
        marginRight: '10px',
    },
};

export default LibraryPage;
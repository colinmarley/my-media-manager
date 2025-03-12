import React from "react";
import { Rating } from "@/types/OmdbResponse.type";
import Grid from "@mui/material/Grid2";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";

enum RatingSource {
    IMDB = "Internet Movie Database",
    RT = "Rotten Tomatoes",
    MC = "Metacritic",
}

interface RatingsInputProps {
    ratings: Rating[];
    numberOfImdbVoters: string;
    setRatings: (ratings: Rating[]) => void;
}

const FormTextField = (
    props: { 
        label: string,
        value: string,
        disabled?: boolean,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
        error?: string | null
    }) => (
        <TextField
            label={props.label}
            value={props.value}
            onChange={props.onChange}
            sx={{input: { color: 'white' }, label: { color: 'white' }}}
            fullWidth
            required
            disabled={props.disabled}
            error={!!props.error}
            helperText={props.error}
        />
);

const RatingsInput = ({ ratings, numberOfImdbVoters, setRatings }: RatingsInputProps) => {
    const [numberOfRatings, setNumberOfRatings] = React.useState(ratings.length);

    React.useEffect(() => {
        setNumberOfRatings(ratings.length);
    }, [ratings]);

    const handleSourceChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const newRatings = [...ratings];
        newRatings[index].Source = e.target.value;
        setRatings(newRatings);
    }

    const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const newRatings = [...ratings];
        newRatings[index].Value = e.target.value;
        setRatings(newRatings);
    }
    
    return (
        <Grid container spacing={2}>
            {ratings.map((rating, index) => (
                <React.Fragment key={`rating-${index}`}>
                    <Grid size={4}>
                        <FormTextField
                            key={`rating-source-${index}`}
                            label={`Rating Source ${index + 1}`}
                            value={rating.Source}
                            onChange={(e) => handleSourceChange(e, index)}
                            />
                    </Grid>
                    {rating.Source === RatingSource.IMDB &&
                        <Grid size={2}>
                            <FormTextField
                                key={`rating-imdb-voters-${index}`}
                                label="Number of voters"
                                disabled={true}
                                value={numberOfImdbVoters}
                                onChange={(e) => {}}
                                />
                        </Grid>
                    }
                    <Grid size={rating.Source === RatingSource.IMDB ? 2 : 4}>
                        <FormTextField
                            key={`rating-value-${index}`}
                            label={`Rating Source ${index + 1}`}
                            value={rating.Value}
                            onChange={(e) => handleValueChange(e, index)}
                            />
                    </Grid>
                    <Grid size={2}>
                        <Button
                            variant="contained"
                            color="secondary"
                            onClick={() => setRatings(ratings.filter((_, i) => i !== index))}
                        >
                            Remove
                        </Button>
                    </Grid>
                    {(index + 1) === numberOfRatings  && <Grid size={2}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => setRatings([...ratings, { Source: '', Value: '' }])}
                        >
                            Add
                        </Button>
                    </Grid>}
                </React.Fragment>
            ))}
        </Grid>
    );
};

export default RatingsInput;

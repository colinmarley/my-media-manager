import React from "react";
import { Rating } from "@/types/OmdbResponse.type";
import Grid from "@mui/material/Grid";
import { FormTextField } from "./common/FormTextField";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { RatingEntry } from "@/types/collections/Common.type";
import { FormInputData } from "@/types/inputs/FormInput.type";

enum RatingSource {
    IMDB = "Internet Movie Database",
    RT = "Rotten Tomatoes",
    MC = "Metacritic",
}

interface RatingsInputProps {
    ratings: FormInputData<RatingEntry[]>;
    setRatings: (ratings: RatingEntry[]) => void;
}

const RatingsInput = ({ ratings, setRatings }: RatingsInputProps) => {
    const [numberOfRatings, setNumberOfRatings] = React.useState(ratings?.value.length);

    React.useEffect(() => {
        setNumberOfRatings(ratings?.value.length);
    }, [ratings]);

    const handleSourceChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const newRatings = [...ratings.value];
        newRatings[index].source = e.target.value;
        setRatings(newRatings);
    }

    const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const newRatings = [...ratings.value];
        newRatings[index].value = e.target.value;
        setRatings(newRatings);
    }
    
    return (
        <Grid container spacing={2}>
            <Grid size={12}>
                <Divider
                    sx={{color: "white"}}
                    variant="fullWidth">
                    Rating Details
                </Divider>
            </Grid>
                {ratings?.value.map((rating: RatingEntry, index: number) => (
                    <React.Fragment key={`rating-${index}`}>
                        <Grid size={6}>
                            <FormTextField
                                key={`rating-source-${index}`}
                                label={`Rating Source ${index + 1}`}
                                value={rating.source}
                                onChange={(e) => handleSourceChange(e, index)}
                                />
                        </Grid>
                        <Grid size={2}>
                            <FormTextField
                                key={`rating-value-${index}`}
                                label={`Rating Source ${index + 1}`}
                                value={rating.value}
                                onChange={(e) => handleValueChange(e, index)}
                                />
                        </Grid>
                        <Grid size={2}>
                            <Button
                                variant="contained"
                                color="secondary"
                                onClick={() => setRatings(ratings?.value.filter((_, i) => i !== index))}
                            >
                                Remove
                            </Button>
                        </Grid>
                        {(index + 1) === numberOfRatings  && <Grid size={2}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => setRatings([...ratings?.value, { source: '', value: '' }])}
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

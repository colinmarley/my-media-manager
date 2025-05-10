
import TextField from "@mui/material/TextField";

interface FormTextFieldProps {
    label: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    required?: boolean;
    multiline?: boolean;
    error?: string | null;
    disabled?: boolean;
}

const FormTextField = (props: FormTextFieldProps) => (
        <TextField
            label={props.label}
            value={props.value}
            onChange={props.onChange}
            sx={{input: { color: 'white' }, label: { color: 'white' }}}
            fullWidth
            required={props?.required}
            multiline={props?.multiline}
            disabled={props.disabled}
            error={!!props.error}
            helperText={props.error}
        />
);

export { FormTextField };
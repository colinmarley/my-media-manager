export interface ValidationResult {
  fieldErrors: Record<string, string[]>;
  formErrors: string[];
}

const isBlank = (value: string | undefined | null): boolean => {
  return !value || value.trim().length === 0;
};

export const emptyValidationResult = (): ValidationResult => ({
  fieldErrors: {},
  formErrors: [],
});

export const toLegacyError = (errors: string[]): string | null => {
  return errors.length > 0 ? errors[0] : null;
};

export const validateRequiredText = (value: string | undefined | null, label: string): string[] => {
  if (isBlank(value)) {
    return [`${label} is required`];
  }
  return [];
};

export const validateNonEmptyArray = <T>(values: T[] | undefined | null, label: string): string[] => {
  if (!values || values.length === 0) {
    return [`At least one ${label} is required`];
  }
  return [];
};

export const validateOptionalNonEmptyArray = <T>(values: T[] | undefined, label: string): string[] => {
  if (values && values.length === 0) {
    return [`At least one ${label} is required`];
  }
  return [];
};

export const validateYear4Digit = (year: string | undefined | null): string[] => {
  const requiredErrors = validateRequiredText(year, 'Year');
  if (requiredErrors.length > 0) {
    return requiredErrors;
  }

  if (!/^\d{4}$/.test((year || '').trim())) {
    return ['Year must be a 4-digit number'];
  }

  return [];
};

export const validateOptionalIsoDate = (value: string | undefined, label: string): string[] => {
  if (!value) {
    return [];
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return [`${label} must be in the format YYYY-MM-DD`];
  }

  return [];
};

export const validateOptionalTextNotEmpty = (value: string | undefined, label: string): string[] => {
  if (value !== undefined && value.trim().length === 0) {
    return [`${label} cannot be empty`];
  }
  return [];
};

export const validateUniqueNumbers = <T extends { number: number }>(
  items: T[],
  label: string,
): string[] => {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const item of items) {
    if (seen.has(item.number)) duplicates.add(item.number);
    seen.add(item.number);
  }
  if (duplicates.size > 0) {
    return [`Duplicate ${label} numbers: ${[...duplicates].join(', ')}`];
  }
  return [];
};
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldValues, useForm, UseFormProps, UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

/**
 * useForm pre-wired with a zod schema. Validation runs on blur, then on every
 * change once a field has been touched. Focusing the first invalid field is
 * handled by <FormDialog> in DOM order, so RHF's own focus is turned off.
 */
export function useZodForm<TIn extends FieldValues, TOut extends FieldValues>(
  schema: z.ZodType<TOut, TIn>,
  props?: Omit<UseFormProps<TIn, unknown, TOut>, 'resolver'>,
): UseFormReturn<TIn, unknown, TOut> {
  return useForm<TIn, unknown, TOut>({
    mode: 'onTouched',
    shouldFocusError: false,
    ...props,
    resolver: zodResolver(schema),
  });
}

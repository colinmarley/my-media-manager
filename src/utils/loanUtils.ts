/**
 * Loans on discs and tapes. There is no loans table: a loan lives in the
 * record's raw_data, which the catalog API returns as the record itself.
 * The edit dialogs write the bare `loanedTo`/`loanedAt`/`returnedAt` fields;
 * the mobile app may also write a `loans` array. Both shapes are read here
 * the same way backend/services/catalog_stats.py reads them for "Lent out".
 */

export interface LoanFields {
  lentTo: string;
  since: string;      // YYYY-MM-DD, '' when unset
  returnedOn: string; // YYYY-MM-DD, '' when unset
}

export interface CurrentLoan {
  lentTo: string;
  since?: string;
}

type LoanRecord = Record<string, unknown>;

const BORROWER_KEYS = ['loanedTo', 'loaned_to', 'lentTo', 'lent_to', 'onLoanTo', 'borrower', 'borrowerName'];
const SINCE_KEYS = ['loanedAt', 'loaned_at', 'dateOut', 'date'];
const RETURN_KEYS = [
  'returned', 'isReturned', 'returnedAt', 'returned_at', 'returnedOn', 'returned_on',
  'returnDate', 'return_date', 'dateReturned', 'dateBack', 'date_back',
];
const FLAG_KEYS = ['onLoan', 'on_loan', 'isOnLoan', 'isLent'];
const FALSE_TEXT = new Set(['', 'false', 'no', 'n', 'none', 'null', '0', 'f']);
const RETURNED_STATUSES = new Set(['returned', 'return', 'back', 'home', 'in', 'complete', 'completed', 'closed', 'done']);

/** Today as YYYY-MM-DD in local time — what a date input compares against. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An error message for the dialog, or null when the loan fields are valid. */
export function validateLoan({ lentTo, since, returnedOn }: LoanFields, today: string = todayIso()): string | null {
  if ((since || returnedOn) && !lentTo.trim()) return 'Enter who it is lent to.';
  if (since && since > today) return '"Since" can\'t be in the future.';
  if (since && returnedOn && returnedOn < since) return '"Returned on" can\'t be before "since".';
  return null;
}

/** The fields to send on save; empty ones go as null so a full PUT clears them. */
export function loanPayload({ lentTo, since, returnedOn }: LoanFields) {
  return {
    loanedTo: lentTo.trim() || null,
    loanedAt: since || null,
    returnedAt: returnedOn || null,
  };
}

/** Prefill for the dialog: the stored bare fields (open or returned), else an
 * open loan from a `loans` array, so saving carries it over as bare fields. */
export function loanFields(item?: object | null): LoanFields {
  const record = item as LoanRecord | null | undefined;
  if (record && !text(record.loanedTo)) {
    const open = currentLoan(record);
    if (open) return { lentTo: open.lentTo === 'Unspecified' ? '' : open.lentTo, since: open.since ?? '', returnedOn: '' };
  }
  return {
    lentTo: text(record?.loanedTo) ?? '',
    since: text(record?.loanedAt) ?? '',
    returnedOn: text(record?.returnedAt) ?? '',
  };
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !FALSE_TEXT.has(value.trim().toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return value != null;
}

function isReturned(record: LoanRecord, statusKeys: string[]): boolean {
  if (RETURN_KEYS.some((key) => key in record && truthy(record[key]))) return true;
  return statusKeys.some((key) => {
    const status = text(record[key]);
    return !!status && RETURNED_STATUSES.has(status.toLowerCase());
  });
}

function pick(record: LoanRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(record[key]);
    if (value && !FALSE_TEXT.has(value.toLowerCase())) return value;
  }
  return undefined;
}

function toLoan(record: LoanRecord): CurrentLoan {
  return { lentTo: pick(record, BORROWER_KEYS) ?? 'Unspecified', since: pick(record, SINCE_KEYS) };
}

/** The loan a record is under right now, or null when it is home. */
export function currentLoan(item: object): CurrentLoan | null {
  const record = item as LoanRecord;
  const list = record.loans;
  const loans = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
  for (let i = loans.length - 1; i >= 0; i -= 1) {
    const loan = loans[i];
    if (loan && typeof loan === 'object' && !isReturned(loan as LoanRecord, ['loanStatus', 'status'])) {
      return toLoan(loan as LoanRecord);
    }
  }
  if (FLAG_KEYS.some((key) => key in record && !truthy(record[key]))) return null;
  if (isReturned(record, ['loanStatus'])) return null;
  if (pick(record, BORROWER_KEYS) || FLAG_KEYS.some((key) => truthy(record[key]))) return toLoan(record);
  return null;
}

/** Items lent out and not yet returned. */
export function filterCurrentlyLent<T extends object>(items: T[]): T[] {
  return items.filter((item) => currentLoan(item) !== null);
}

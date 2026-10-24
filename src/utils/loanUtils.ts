/**
 * Loans on discs and tapes. There is no loans table: a loan lives in the
 * record's raw_data, which the catalog API returns as the record itself.
 * The edit dialogs write the bare `loanedTo`/`loanedAt`/`returnedAt` fields;
 * the mobile app may also write a `loans`/`loanHistory`/`lendingHistory` list.
 * Both shapes are read here exactly the way backend/services/catalog_stats.py
 * reads them for "Lent out" (see the loan contract in its docstring), so the
 * "Currently lent" view and the Stats page agree. Keep the key lists in sync.
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

const UNKNOWN_LABEL = 'Unspecified';

const LOAN_LIST_KEYS = ['loans', 'loanHistory', 'loan_history', 'lendingHistory', 'lending_history'] as const;
const BORROWER_KEYS = [
  'loanedTo', 'loaned_to', 'onLoanTo', 'on_loan_to', 'lentTo', 'lent_to',
  'borrower', 'borrowerName', 'borrowed_by', 'person', 'who', 'name',
];
// Record level only: `name`/`who`/`person` there are the title, not a borrower.
const BARE_BORROWER_KEYS = [
  'loanedTo', 'loaned_to', 'onLoanTo', 'on_loan_to', 'lentTo', 'lent_to',
  'borrower', 'borrowerName', 'borrowed_by',
] as const;
const BORROWER_NAME_KEYS = ['name', 'fullName', 'full_name', 'borrower', 'person', 'who', 'label', 'title'];
const LOAN_FLAG_KEYS = [
  'onLoan', 'on_loan', 'isOnLoan', 'is_on_loan', 'loanOut', 'loan_out', 'isLent', 'is_lent',
] as const;
const LOAN_BARE_KEYS: readonly string[] = [...BARE_BORROWER_KEYS, ...LOAN_FLAG_KEYS];
const SINCE_KEYS = [
  'loanedAt', 'loaned_at', 'date', 'dateOut', 'dateLent', 'loanDate', 'dateLoan',
  'checkedOut', 'borrowedDate', 'startedAt', 'out',
];
// Record level only: a record's own `date` is not when it was lent.
const BARE_SINCE_KEYS = ['loanedAt', 'loaned_at', 'dateLent', 'loanDate'];
const RETURN_MARKERS = [
  'returned', 'isReturned', 'is_returned', 'returnToOwner', 'return_to_owner',
  'returnedAt', 'returned_at', 'returnedOn', 'returned_on',
  'returnedDate', 'returned_date', 'dateReturned', 'date_returned',
  'returnDate', 'return_date', 'dateBack', 'date_back', 'dateIn', 'date_in',
];
const LOAN_STATUS_KEYS = ['loanStatus', 'loan_status', 'loanState', 'loan_state', 'status', 'state'];
// A record-level `status` on a series is the series status, not a loan's.
const RECORD_LOAN_STATUS_KEYS = ['loanStatus', 'loan_status', 'loanState', 'loan_state'];
const RETURNED_STATUSES = new Set([
  'returned', 'return', 'back', 'home', 'in', 'given back', 'gave back', 'lended back',
  'complete', 'completed', 'ended', 'closed', 'done',
]);
const FALSE_TEXT = new Set(['', 'false', 'no', 'n', 'none', 'null', '0', 'f']);

type LoanListKey = typeof LOAN_LIST_KEYS[number];
type LoanBareKey = typeof BARE_BORROWER_KEYS[number] | typeof LOAN_FLAG_KEYS[number];

/** What a dialog save sends: bare fields, or the loan list with the edited entry. */
export type LoanPayload = {
  loanedTo?: string | null;
  loanedAt?: string | null;
  returnedAt?: string | null;
} & Partial<Record<LoanListKey | LoanBareKey, unknown>>;

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
  if (returnedOn && returnedOn > today) return '"Returned on" can\'t be in the future.';
  if (since && returnedOn && returnedOn < since) return '"Returned on" can\'t be before "since".';
  return null;
}

/**
 * The fields to send on save; empty ones go as null so a full PUT clears them.
 * When the loan being edited is an open entry of a loan list (the mobile
 * app's shape), the edit is written into that entry instead — a bare
 * `returnedAt` would not close it, because the list is read first.
 */
export function loanPayload({ lentTo, since, returnedOn }: LoanFields, item?: object | null): LoanPayload {
  const record = item as LoanRecord | null | undefined;
  const name = lentTo.trim() || null;
  const open = record ? openListLoan(record) : null;
  if (open) {
    const entry: LoanRecord = { ...open.loan, loanedTo: name, loanedAt: since || null, returnedAt: returnedOn || null };
    // Clearing every field means the item is home; the borrower stays on record.
    if (!name) entry.returned = true;
    const value = open.index === null
      ? entry
      : (record![open.key] as unknown[]).map((loan, i) => (i === open.index ? entry : loan));
    return { [open.key]: value };
  }
  const payload: LoanPayload = { loanedTo: name, loanedAt: since || null, returnedAt: returnedOn || null };
  // Other bare loan keys an earlier write left behind would outrank or reopen this one.
  if (record) {
    for (const key of BARE_BORROWER_KEYS) if (key !== 'loanedTo' && key in record) payload[key] = null;
    for (const key of LOAN_FLAG_KEYS) if (key in record) payload[key] = !!name && !returnedOn;
  }
  return payload;
}

/** Prefill for the dialog: the open entry of a loan list if there is one
 * (that is what `currentLoan` shows), else the stored bare fields. */
export function loanFields(item?: object | null): LoanFields {
  const record = item as LoanRecord | null | undefined;
  if (!record) return { lentTo: '', since: '', returnedOn: '' };
  const open = openListLoan(record);
  if (open) {
    const who = borrower(open.loan);
    return { lentTo: who === UNKNOWN_LABEL ? '' : who, since: pick(open.loan, SINCE_KEYS) ?? '', returnedOn: '' };
  }
  const bare = bareLoan(record);
  const who = bare ? borrower(bare) : UNKNOWN_LABEL;
  return {
    lentTo: who === UNKNOWN_LABEL ? '' : who,
    since: pick(record, BARE_SINCE_KEYS) ?? '',
    returnedOn: text(record.returnedAt) ?? '',
  };
}

function isObject(value: unknown): value is LoanRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function flagOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !FALSE_TEXT.has(value.trim().toLowerCase());
  if (value == null) return false;
  if (typeof value === 'number') return value !== 0;
  return true; // a sub-document naming someone is a loan
}

function hasReturnMarker(record: LoanRecord): boolean {
  return RETURN_MARKERS.some((key) => key in record && flagOn(record[key]));
}

function statusIsReturned(record: LoanRecord, keys: string[]): boolean {
  for (const key of keys) {
    const status = text(record[key]);
    if (status) return RETURNED_STATUSES.has(status.toLowerCase());
  }
  return false;
}

function isReturned(loan: LoanRecord): boolean {
  return hasReturnMarker(loan) || statusIsReturned(loan, LOAN_STATUS_KEYS);
}

function pick(record: LoanRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(record[key]);
    if (value && !FALSE_TEXT.has(value.toLowerCase())) return value;
  }
  return undefined;
}

function borrower(loan: LoanRecord): string {
  for (const key of BORROWER_KEYS) {
    const value = loan[key];
    const name = isObject(value) ? pick(value, BORROWER_NAME_KEYS) : text(value);
    if (name && !FALSE_TEXT.has(name.toLowerCase())) return name;
  }
  return UNKNOWN_LABEL;
}

/** The newest unreturned entry of the record's loan list, and where it sits. */
function openListLoan(record: LoanRecord): { key: LoanListKey; index: number | null; loan: LoanRecord } | null {
  for (const key of LOAN_LIST_KEYS) {
    const value = record[key];
    if (isObject(value)) return isReturned(value) ? null : { key, index: null, loan: value };
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        const loan = value[i];
        if (isObject(loan) && !isReturned(loan)) return { key, index: i, loan };
      }
      return null;
    }
  }
  return null;
}

/** The loan the record's bare fields describe (borrower read via `borrower`),
 * or null. An explicit `onLoan: false` closes it. */
function bareLoan(record: LoanRecord): LoanRecord | null {
  if (LOAN_FLAG_KEYS.some((key) => key in record && !flagOn(record[key]))) return null;
  for (const key of LOAN_BARE_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (isObject(value)) return { [key]: value };
    if (typeof value === 'boolean') {
      if (value) return {}; // out, borrower unknown
      continue;
    }
    const name = text(value);
    if (!name || FALSE_TEXT.has(name.toLowerCase()) || RETURNED_STATUSES.has(name.toLowerCase())) continue;
    return { [key]: name };
  }
  return null;
}

/** The loan a record is under right now, or null when it is home. */
export function currentLoan(item: object): CurrentLoan | null {
  const record = item as LoanRecord;
  const open = openListLoan(record);
  if (open) return { lentTo: borrower(open.loan), since: pick(open.loan, SINCE_KEYS) };
  const bare = bareLoan(record);
  if (!bare || hasReturnMarker(record) || statusIsReturned(record, RECORD_LOAN_STATUS_KEYS)) return null;
  return { lentTo: borrower(bare), since: pick(record, BARE_SINCE_KEYS) };
}

/** Items lent out and not yet returned. */
export function filterCurrentlyLent<T extends object>(items: T[]): T[] {
  return items.filter((item) => currentLoan(item) !== null);
}

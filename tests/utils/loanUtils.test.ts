/**
 * Unit tests for loanUtils — the loan fields on the disc/tape edit dialogs
 * and the "Currently lent" filter on the physical media page.
 */

import {
  currentLoan, filterCurrentlyLent, loanFields, loanPayload, validateLoan,
} from '../../src/utils/loanUtils';

const TODAY = '2026-10-24';

describe('loanUtils', () => {
  describe('validateLoan', () => {
    it('accepts an empty loan', () => {
      expect(validateLoan({ lentTo: '', since: '', returnedOn: '' }, TODAY)).toBeNull();
    });

    it('accepts a loan that started today and is still out', () => {
      expect(validateLoan({ lentTo: 'Sam', since: TODAY, returnedOn: '' }, TODAY)).toBeNull();
    });

    it('rejects a "since" date in the future', () => {
      expect(validateLoan({ lentTo: 'Sam', since: '2026-10-25', returnedOn: '' }, TODAY))
        .toMatch(/future/);
    });

    it('rejects "returned on" before "since"', () => {
      expect(validateLoan({ lentTo: 'Sam', since: '2026-10-10', returnedOn: '2026-10-09' }, TODAY))
        .toMatch(/before/);
    });

    it('accepts "returned on" the same day as "since"', () => {
      expect(validateLoan({ lentTo: 'Sam', since: '2026-10-10', returnedOn: '2026-10-10' }, TODAY)).toBeNull();
    });

    it('rejects a "returned on" date in the future', () => {
      expect(validateLoan({ lentTo: 'Sam', since: '2026-10-10', returnedOn: '2026-10-25' }, TODAY))
        .toMatch(/future/);
    });

    it('requires who it was lent to once a date is set', () => {
      expect(validateLoan({ lentTo: ' ', since: '2026-10-10', returnedOn: '' }, TODAY))
        .toMatch(/lent to/i);
    });
  });

  describe('loanPayload', () => {
    it('writes the bare loan fields the server reads, clearing empty ones with null', () => {
      expect(loanPayload({ lentTo: ' Sam ', since: '2026-10-10', returnedOn: '' })).toEqual({
        loanedTo: 'Sam', loanedAt: '2026-10-10', returnedAt: null,
      });
    });

    it('closes an open loans[] entry instead of writing bare fields', () => {
      const rec = { loans: [{ borrower: 'Ana', returnedAt: '2026-08-01' }, { borrower: 'Kim', loanedAt: '2026-09-01' }] };
      const saved = { ...rec, ...loanPayload({ ...loanFields(rec), returnedOn: '2026-10-01' }, rec) };
      expect(saved.loans[0]).toEqual(rec.loans[0]);
      expect(saved.loans[1]).toMatchObject({ borrower: 'Kim', returnedAt: '2026-10-01' });
      expect(currentLoan(saved)).toBeNull();
    });

    it('closes a single loan object under loanHistory', () => {
      const rec = { loanHistory: { loanedTo: { name: 'Sam' } } };
      const saved = { ...rec, ...loanPayload({ ...loanFields(rec), returnedOn: '2026-10-01' }, rec) };
      expect(currentLoan(saved)).toBeNull();
    });

    it('marks a list loan returned when the dialog fields are cleared', () => {
      const rec = { loans: [{ borrower: 'Kim' }] };
      const saved = { ...rec, ...loanPayload({ lentTo: '', since: '', returnedOn: '' }, rec) };
      expect(currentLoan(saved)).toBeNull();
    });

    it('clears other bare loan keys so they do not reopen the loan', () => {
      const rec = { lentTo: 'Kim', loanOut: true };
      const saved = { ...rec, ...loanPayload({ lentTo: 'Kim', since: '', returnedOn: '2026-10-01' }, rec) };
      expect(saved).toMatchObject({ lentTo: null, loanOut: false });
      expect(currentLoan(saved)).toBeNull();
    });
  });

  describe('loanFields', () => {
    it('prefills from the stored bare fields, returned or not', () => {
      expect(loanFields({ loanedTo: 'Sam', loanedAt: '2026-10-01', returnedAt: '2026-10-05' }))
        .toEqual({ lentTo: 'Sam', since: '2026-10-01', returnedOn: '2026-10-05' });
    });

    it('carries an open loan from a loans array into the dialog', () => {
      expect(loanFields({ loans: [{ borrower: 'Kim', loanedAt: '2026-09-01' }] }))
        .toEqual({ lentTo: 'Kim', since: '2026-09-01', returnedOn: '' });
    });

    it('is empty for a new item', () => {
      expect(loanFields(null)).toEqual({ lentTo: '', since: '', returnedOn: '' });
    });
  });

  describe('currentLoan', () => {
    it('reads an open bare-field loan', () => {
      expect(currentLoan({ loanedTo: 'Sam', loanedAt: '2026-10-01' }))
        .toEqual({ lentTo: 'Sam', since: '2026-10-01' });
    });

    it('treats a returned bare-field loan as home', () => {
      expect(currentLoan({ loanedTo: 'Sam', loanedAt: '2026-10-01', returnedAt: '2026-10-05' })).toBeNull();
    });

    it('treats onLoan: false as home', () => {
      expect(currentLoan({ loanedTo: 'Sam', onLoan: false })).toBeNull();
    });

    it('reads the newest open entry of a loans array', () => {
      expect(currentLoan({
        loans: [
          { loanedTo: 'Ana', loanedAt: '2026-01-05' },
          { loanedTo: 'Ben', loanedAt: '2026-02-01', returnedAt: '2026-02-04' },
        ],
      })).toEqual({ lentTo: 'Ana', since: '2026-01-05' });
    });

    it('is null with no loan at all', () => {
      expect(currentLoan({ title: 'Kept at home', name: 'Disc 1', status: 'Ended' })).toBeNull();
    });

    // Every shape the loan contract in backend/services/catalog_stats.py accepts.
    it.each(['loanHistory', 'loan_history', 'lendingHistory', 'lending_history'])(
      'reads a loan list under %s', (key) => {
        expect(currentLoan({ [key]: [{ loanedTo: 'Bo', dateOut: '2026-10-01' }] }))
          .toEqual({ lentTo: 'Bo', since: '2026-10-01' });
      },
    );

    it.each(['onLoan', 'on_loan', 'isOnLoan', 'is_on_loan', 'loanOut', 'loan_out', 'isLent', 'is_lent'])(
      'reads the %s flag, true or false', (key) => {
        expect(currentLoan({ [key]: true })).toEqual({ lentTo: 'Unspecified', since: undefined });
        expect(currentLoan({ [key]: 'false', loanedTo: 'Sam' })).toBeNull();
      },
    );

    it.each(['name', 'fullName', 'full_name', 'person', 'who', 'label', 'title'])(
      'reads a nested borrower under %s', (key) => {
        expect(currentLoan({ loans: [{ loanedTo: { [key]: 'Sam' } }] })?.lentTo).toBe('Sam');
        expect(currentLoan({ loanedTo: { [key]: 'Sam' } })?.lentTo).toBe('Sam');
      },
    );

    it.each(['person', 'who', 'name', 'borrowed_by', 'on_loan_to'])('reads a list borrower under %s', (key) => {
      expect(currentLoan({ loans: [{ [key]: 'Kim' }] })?.lentTo).toBe('Kim');
    });

    it.each(['dateIn', 'returnToOwner', 'is_returned', 'returned_date', 'date_returned'])(
      'treats %s as a return marker', (key) => {
        expect(currentLoan({ loans: [{ loanedTo: 'Kim', [key]: '2026-10-01' }] })).toBeNull();
        expect(currentLoan({ loanedTo: 'Kim', [key]: '2026-10-01' })).toBeNull();
      },
    );

    it('reads a returned status from loan_state in a list and loanState on the record', () => {
      expect(currentLoan({ loans: [{ loanedTo: 'Kim', loan_state: 'given back' }] })).toBeNull();
      expect(currentLoan({ loans: [{ loanedTo: 'Kim', state: 'out' }] })?.lentTo).toBe('Kim');
      expect(currentLoan({ loanedTo: 'Kim', loanState: 'returned' })).toBeNull();
    });

    it('does not let a bare return marker close an open list entry', () => {
      expect(currentLoan({ loans: [{ loanedTo: 'Kim' }], returned: true })?.lentTo).toBe('Kim');
    });
  });

  describe('filterCurrentlyLent', () => {
    it('keeps only items lent out and not yet returned', () => {
      const items = [
        { id: 'out', loanedTo: 'Sam', loanedAt: '2026-10-01' },
        { id: 'back', loanedTo: 'Bo', loanedAt: '2026-09-01', returnedAt: '2026-09-10' },
        { id: 'never', title: 'Never lent' },
        { id: 'blank', loanedTo: '', returnedAt: null },
        { id: 'array', loans: [{ loanedTo: 'Ana', loanedAt: '2026-10-02' }] },
        { id: 'history', loanHistory: [{ loanedTo: 'Bo' }] },
        { id: 'history-back', lendingHistory: [{ loanedTo: 'Bo', dateBack: '2026-10-03' }] },
        { id: 'flag', loanOut: true },
        { id: 'flag-off', is_lent: false, lentTo: 'Cy' },
        { id: 'nested', loans: [{ loanedTo: { name: 'Sam' } }] },
      ];
      expect(filterCurrentlyLent(items).map((i) => i.id)).toEqual(['out', 'array', 'history', 'flag', 'nested']);
    });
  });
});

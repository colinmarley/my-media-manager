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
      expect(currentLoan({ title: 'Kept at home' })).toBeNull();
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
      ];
      expect(filterCurrentlyLent(items).map((i) => i.id)).toEqual(['out', 'array']);
    });
  });
});

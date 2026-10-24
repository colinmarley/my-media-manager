import { currentLoan, loanFields, loanPayload } from '../../src/utils/loanUtils';

describe('probe', () => {
  it('loanHistory shape', () => {
    expect(currentLoan({ loanHistory: [{ loanedTo: 'Bo' }] })).not.toBeNull();
  });
  it('nested borrower', () => {
    expect(currentLoan({ loans: [{ loanedTo: { name: 'Sam' } }] })?.lentTo).toBe('Sam');
  });
  it('loanOut flag', () => {
    expect(currentLoan({ loanOut: true })).not.toBeNull();
  });
  it('returning a loans[] loan via the dialog closes it', () => {
    const rec = { loans: [{ borrower: 'Kim', loanedAt: '2026-09-01' }] };
    const fields = loanFields(rec);
    const saved = { ...rec, ...loanPayload({ ...fields, returnedOn: '2026-10-01' }, rec) };
    expect(currentLoan(saved)).toBeNull();
  });
});

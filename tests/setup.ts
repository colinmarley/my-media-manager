import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Backwards compatibility for existing tests that use jest.* APIs.
(globalThis as any).jest = vi;

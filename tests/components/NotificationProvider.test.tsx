import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
  NotificationProvider,
  notify,
  useConfirm,
  useNotify,
} from '../../src/context/NotificationContext';

const NotifyButton: React.FC = () => {
  const notifyFn = useNotify();
  return <button onClick={() => notifyFn('Saved!', 'success')}>notify</button>;
};

const ConfirmButton: React.FC<{ onResult: (result: boolean) => void }> = ({ onResult }) => {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => onResult(await confirm({ title: 'Delete?', message: 'This cannot be undone.' }))}
    >
      ask
    </button>
  );
};

describe('NotificationProvider', () => {
  it('shows a snackbar alert with the right severity from useNotify()', async () => {
    render(
      <NotificationProvider>
        <NotifyButton />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByText('notify'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Saved!');
    expect(alert.className).toMatch(/Success/);
  });

  it('routes the module-level notify() through the mounted provider', async () => {
    render(<NotificationProvider><div /></NotificationProvider>);
    act(() => notify('From a service', 'error'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('From a service');
    expect(alert.className).toMatch(/Error/);
  });

  it('useConfirm() resolves true when confirmed', async () => {
    const results: boolean[] = [];
    render(
      <NotificationProvider>
        <ConfirmButton onResult={(r) => results.push(r)} />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByText('ask'));
    expect(await screen.findByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('useConfirm() resolves false when cancelled', async () => {
    const results: boolean[] = [];
    render(
      <NotificationProvider>
        <ConfirmButton onResult={(r) => results.push(r)} />
      </NotificationProvider>
    );
    fireEvent.click(screen.getByText('ask'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(results).toEqual([false]));
  });
});

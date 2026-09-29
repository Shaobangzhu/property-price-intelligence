// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App.js';

afterEach(cleanup);
it('shows dashboard and available API state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'live', requestId: 'synthetic' })));
  render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('loading');
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('available'));
  expect(screen.getByRole('link', { name: 'History' }).getAttribute('href')).toBe('/history');
});
it('shows unavailable API state on failure and History placeholder', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic')));
  render(<MemoryRouter initialEntries={['/history']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('unavailable'));
});

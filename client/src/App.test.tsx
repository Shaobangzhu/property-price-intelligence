// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App.js';

const renderAt = (path = '/dashboard') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'live', requestId: 'synthetic' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('demo workspace', () => {
  it('navigates between Dashboard and History with a persistent shell', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    const historyLink = screen.getByRole('link', { name: 'History' });
    fireEvent.click(historyLink);
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(historyLink.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('link', { name: 'New Search' }));
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('API: available')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/health\/live$/);
  });

  it('searches only fixture addresses and shows a clear not-found state', () => {
    renderAt();
    const input = screen.getByRole('textbox', { name: 'Search a demo address' });
    fireEvent.change(input, { target: { value: '26 Crescent Court' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('heading', { name: /26 Crescent Court/ })).toBeTruthy();
    expect(screen.getByText('No comparable sales')).toBeTruthy();
    expect(screen.getAllByText('Not analyzed').length).toBeGreaterThan(0);
    fireEvent.change(input, { target: { value: '999 Unknown Road' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('Demo property not found')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No property selected')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows one map context at a time and toggles the active context off', () => {
    renderAt();
    const schools = screen.getByRole('button', { name: 'Schools' });
    const grocery = screen.getByRole('button', { name: 'Grocery' });
    fireEvent.click(schools);
    expect(schools.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Assigned Schools' })).toBeTruthy();
    fireEvent.click(grocery);
    expect(schools.getAttribute('aria-pressed')).toBe('false');
    expect(grocery.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Grocery nearby' })).toBeTruthy();
    fireEvent.click(grocery);
    expect(grocery.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('No context selected')).toBeTruthy();
  });

  it.each([['Offer Price', 'Offer Price Analysis'], ['Listing Price', 'Listing Price Analysis']])('opens and closes %s accessibly', (buttonName, title) => {
    renderAt();
    const trigger = screen.getByRole('button', { name: buttonName });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps focus and restores it after Escape', () => {
    renderAt();
    const trigger = screen.getByRole('button', { name: 'Offer Price' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const closeIcon = within(dialog).getByRole('button', { name: 'Close dialog' });
    const closeFooter = within(dialog).getByRole('button', { name: 'Close' });
    closeFooter.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeIcon);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeFooter);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows analysis and context empty states for a sparse fixture', () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: '26 Crescent Court' }));
    fireEvent.click(screen.getByRole('button', { name: 'Schools' }));
    expect(screen.getByText('No assigned-school data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grocery' }));
    expect(screen.getByText('No grocery demo data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Offer Price' }));
    expect(screen.getByText('Analysis not generated')).toBeTruthy();
  });

  it('keeps fixture labeling and does not treat server failure as a property lookup', async () => {
    fetchMock.mockRejectedValue(new Error('synthetic outage'));
    renderAt();
    await waitFor(() => expect(screen.getByText('API: unavailable')).toBeTruthy());
    expect(screen.getByText(/Fixture data only/)).toBeTruthy();
    expect(screen.getByText(/Server unavailable/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('History', () => {
  it('selects a record, filters it, and shows an empty result', () => {
    renderAt('/history');
    expect(screen.getByRole('heading', { name: 'Selected Record Details' })).toBeTruthy();
    const detail = screen.getByRole('complementary', { name: 'Selected Record Details' });
    expect(detail.textContent).toContain('1847 Alder View Lane');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!.closest('tr')!);
    expect(detail.textContent).toContain('901 Cedar Row');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search by address' }), { target: { value: 'Unknown' } });
    expect(screen.getByText('History empty')).toBeTruthy();
    expect(detail.textContent).toContain('No record selected');
  });
});

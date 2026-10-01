import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { HealthResponse } from '@ppi/shared';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { HistoryPage } from './features/history/HistoryPage.js';

export function ApiStatus() {
  const [status, setStatus] = useState<'loading' | 'available' | 'unavailable'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    fetch(`${base.replace(/\/$/, '')}/health/live`, { signal: controller.signal })
      .then(async response => { const parsed = HealthResponse.safeParse(await response.json()); return response.ok && parsed.success && parsed.data.status === 'live'; })
      .then(ok => { if (!controller.signal.aborted) setStatus(ok ? 'available' : 'unavailable'); })
      .catch(() => { if (!controller.signal.aborted) setStatus('unavailable'); });
    return () => controller.abort();
  }, []);
  return <div className="api-status-wrap"><p className={`api-status api-${status}`} role="status"><span className="status-dot" aria-hidden="true" />API: {status}</p>{status === 'unavailable' && <p className="api-notice" role="alert">Server unavailable. Saved property requests require the local API.</p>}</div>;
}

export function App() {
  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <NavLink to="/dashboard" className="brand" aria-label="Property Price Intelligence home"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m3.5 11 8.5-7 8.5 7v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M9 20v-6h6v6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg></span><span>Property Price <strong>Intelligence</strong></span></NavLink>
      <nav className="main-nav" aria-label="Main navigation"><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/history">History</NavLink></nav>
      <div className="topbar-right"><span className="workspace-badge">Local workspace</span><ApiStatus /><span className="avatar" aria-label="User placeholder">PI</span></div>
    </div></header>
    <main className="app-main"><Routes><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<DashboardPage />} /><Route path="/history" element={<HistoryPage />} /><Route path="*" element={<section className="card not-found"><h1>Page not found</h1><NavLink to="/dashboard">Go to Dashboard</NavLink></section>} /></Routes></main>
  </div>;
}

import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { HealthResponse } from '@ppi/shared';

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
  return <p role="status">API: {status}</p>;
}

export function App() {
  return <div className="shell"><header><h1>Property Price Intelligence</h1><nav aria-label="Main navigation"><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/history">History</NavLink></nav><ApiStatus /></header><main><Routes><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<section><h2>Dashboard</h2><p>Placeholder: property evidence, map, and pricing dialogs are not implemented yet.</p></section>} /><Route path="/history" element={<section><h2>History</h2><p>Placeholder: saved properties and analyses are not implemented yet.</p></section>} /><Route path="*" element={<section><h2>Page not found</h2></section>} /></Routes></main></div>;
}

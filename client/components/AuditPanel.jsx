'use client';

import { useEffect, useState } from 'react';
import { FiActivity, FiCheck, FiClock, FiRefreshCw, FiSearch, FiShield } from 'react-icons/fi';
import AppPage from './AppPage';
import { fetchAuditEvents, fetchJobs, cancelJob } from '../lib/api';

function timestamp(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}
function tone(value) {
  return /failed|denied|expired|interrupted|cancelled/.test(value) ? 'is-error' : /completed|allow|running/.test(value) ? 'is-running' : '';
}

export default function AuditPanel({ bots = [] }) {
  const [jobs, setJobs] = useState([]);
  const [events, setEvents] = useState([]);
  const [view, setView] = useState('jobs');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const name = id => bots.find(bot => bot.id === id)?.name || id || 'Workspace';
  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [audit, background] = await Promise.all([fetchAuditEvents(200), fetchJobs()]);
      setEvents([...audit].reverse()); setJobs(background); setError('');
    } catch (failure) { setError(failure.message || 'Could not refresh activity.'); }
    finally { if (!quiet) setLoading(false); }
  };
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const [audit, background] = await Promise.all([fetchAuditEvents(200), fetchJobs()]);
        if (mounted) { setEvents([...audit].reverse()); setJobs(background); setError(''); }
      } catch (failure) { if (mounted) setError(failure.message); }
      finally { if (mounted) setLoading(false); }
    }
    refresh(); const timer = setInterval(refresh, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  const filteredJobs = jobs.filter(job => `${name(job.thread_id)} ${job.status} ${job.error || ''}`.toLowerCase().includes(query.toLowerCase()));
  const filteredEvents = events.filter(item => `${item.event || item.type} ${item.tool || ''} ${item.connector || ''} ${name(item.thread_id)}`.toLowerCase().includes(query.toLowerCase()));
  const items = view === 'jobs' ? filteredJobs : filteredEvents;
  const stop = async id => {
    setBusy(id);
    try { await cancelJob(id); await load(true); } catch (failure) { setError(failure.message); }
    finally { setBusy(null); }
  };
  return <AppPage title="Activity" description="Follow Poka’s work and review your audit trail." actions={<button className="icon-button" onClick={() => load()} aria-label="Refresh activity" title="Refresh activity"><FiRefreshCw className={loading ? 'animate-spin' : ''} /></button>}>
    <div className="app-toolbar">
      <div className="app-segments" role="group" aria-label="Activity view"><button className={view === 'jobs' ? 'selected' : ''} aria-pressed={view === 'jobs'} onClick={() => setView('jobs')}>Background jobs <span>{jobs.length}</span></button><button className={view === 'audit' ? 'selected' : ''} aria-pressed={view === 'audit'} onClick={() => setView('audit')}>Audit trail <span>{events.length}</span></button></div>
      <label className="app-search"><FiSearch /><input aria-label="Search activity" placeholder="Search activity" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="app-notice is-error" role="alert">{error}</p>}
    <div className="activity-list">
      {items.map((item, index) => {
        const status = view === 'jobs' ? item.status : item.event || item.type || 'Recorded';
        const active = ['running', 'queued'].includes(status);
        const title = view === 'jobs' ? name(item.thread_id) : item.tool || item.connector || 'Workspace action';
        return <div className="activity-row" key={item.id || `${item.created_at}-${item.request_id}-${index}`}>
          <div className={`activity-icon ${tone(status)}`}>{view === 'audit' ? <FiShield /> : active ? <FiActivity /> : status === 'completed' ? <FiCheck /> : <FiClock />}</div>
          <div className="activity-row-content"><div className="activity-row-heading"><h3>{title}</h3><span className={`app-status ${tone(status)}`}><span />{status.replaceAll(/[._]/g, ' ')}</span></div><p>{timestamp(item.updated_at || item.created_at)}{view === 'jobs' && item.attempts > 0 ? ` · Attempt ${item.attempts}` : ''}</p>{item.error && <p className="is-error">{item.error}</p>}
            <details className="activity-details"><summary>Details</summary><dl>{[['Request', item.request_id], ['Assistant', name(item.thread_id)], ['Job', view === 'jobs' ? item.id : null], ['Removed items', item.removed]].filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
          </div>
          {view === 'jobs' && active && <button className="soft-button" disabled={busy === item.id} onClick={() => stop(item.id)}>{busy === item.id ? 'Stopping…' : 'Stop'}</button>}
        </div>;
      })}
    </div>
    {!items.length && <div className="app-empty">{view === 'jobs' ? <FiActivity /> : <FiShield />}<h3>{loading ? 'Loading activity…' : query ? 'No matching activity' : view === 'jobs' ? 'All quiet for now' : 'No actions recorded yet'}</h3><p>{query ? 'Try another search term.' : view === 'jobs' ? 'Tasks appear here when Poka starts working.' : 'Approvals and computer actions will appear here.'}</p></div>}
  </AppPage>;
}

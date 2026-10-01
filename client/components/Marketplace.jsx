'use client';

import AppPage from './AppPage';
import React, { useEffect, useState } from 'react';
import {
  FiPlus,
  FiAlertCircle,
  FiCheck,
  FiExternalLink,
  FiRefreshCw,
  FiSearch,
  FiSettings,
  FiZap,
} from 'react-icons/fi';
import {
  authorizeConnector,
  disconnectConnector,
  fetchConnectionStatus,
  fetchConnectorCatalog,
} from '../lib/api';

// A stable fallback keeps the marketplace useful when the API or connector key
// is not configured yet.
const CURATED_APPS = [
  { slug: 'github', label: 'GitHub', blurb: 'Issues, pull requests, and code', domain: 'github.com' },
  { slug: 'slack', label: 'Slack', blurb: 'Post updates and read channels', domain: 'slack.com' },
  { slug: 'gmail', label: 'Gmail', blurb: 'Read and send email', domain: 'gmail.com' },
  { slug: 'googlecalendar', label: 'Google Calendar', blurb: 'Read and create calendar events', domain: 'calendar.google.com' },
  { slug: 'googlesheets', label: 'Google Sheets', blurb: 'Read and update spreadsheets', domain: 'sheets.google.com' },
  { slug: 'googledocs', label: 'Google Docs', blurb: 'Read and write documents', domain: 'docs.google.com' },
  { slug: 'googledrive', label: 'Google Drive', blurb: 'Browse and manage files', domain: 'drive.google.com' },
  { slug: 'notion', label: 'Notion', blurb: 'Pages and databases', domain: 'notion.so' },
  { slug: 'linear', label: 'Linear', blurb: 'Issues and project tracking', domain: 'linear.app' },
  { slug: 'discord', label: 'Discord', blurb: 'Messages and channels', domain: 'discord.com' },
  { slug: 'x', label: 'X (Twitter)', blurb: 'Post and read on X', domain: 'x.com' },
  { slug: 'hubspot', label: 'HubSpot', blurb: 'CRM search and updates', domain: 'hubspot.com' },
  { slug: 'salesforce', label: 'Salesforce', blurb: 'CRM records and reports', domain: 'salesforce.com' },
  { slug: 'jira', label: 'Jira', blurb: 'Issues and sprints', domain: 'atlassian.com' },
  { slug: 'asana', label: 'Asana', blurb: 'Tasks and projects', domain: 'asana.com' },
  { slug: 'trello', label: 'Trello', blurb: 'Boards and cards', domain: 'trello.com' },
  { slug: 'dropbox', label: 'Dropbox', blurb: 'Files and folders', domain: 'dropbox.com' },
  { slug: 'airtable', label: 'Airtable', blurb: 'Bases and records', domain: 'airtable.com' },
  { slug: 'figma', label: 'Figma', blurb: 'Files and comments', domain: 'figma.com' },
  { slug: 'stripe', label: 'Stripe', blurb: 'Payments and customers', domain: 'stripe.com' },
  { slug: 'zapier', label: 'Zapier', blurb: 'Connect apps through automation', domain: 'zapier.com' },
  { slug: 'reddit', label: 'Reddit', blurb: 'Browse and post on Reddit', domain: 'reddit.com' },
  { slug: 'sentry', label: 'Sentry', blurb: 'Errors, alerts, and performance', domain: 'sentry.io' },
  { slug: 'posthog', label: 'PostHog', blurb: 'Analytics and feature flags', domain: 'posthog.com' },
];

function normalizeCard(app) {
  return {
    slug: app.slug || app.key || app.name,
    label: app.label || app.name || app.slug,
    blurb: app.blurb || app.description || 'Connector integration',
    domain: app.domain || '',
    logo: app.logo || null,
  };
}

function AppIcon({ app }) {
  const [failed, setFailed] = useState(false);
  const source = app.logo || (app.domain
    ? `https://www.google.com/s2/favicons?domain=${app.domain}&sz=64`
    : null);

  if (source && !failed) {
    return (
      <img
        src={source}
        alt=""
        className="w-8 h-8 rounded-lg object-contain flex-shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-lg bg-[#27272a] flex items-center justify-center text-xs font-bold text-zinc-300 border border-[#333338] flex-shrink-0">
      {(app.label || '?').charAt(0).toUpperCase()}
    </div>
  );
}

export default function Marketplace({ onOpenSettings }) {
  const [apps, setApps] = useState(CURATED_APPS);
  const [connected, setConnected] = useState([]);
  const [search, setSearch] = useState('');
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState('curated');
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function loadMarketplace() {
      setLoading(true);
      setError('');

      const catalog = await fetchConnectorCatalog();
      const nextApps = (catalog.cards || []).length
        ? catalog.cards.map(normalizeCard)
        : CURATED_APPS;

      if (!mounted) return;
      setApps(nextApps);
      setConfigured(Boolean(catalog.configured));
      setSource(catalog.source || 'curated');

      if (catalog.configured && nextApps.length) {
        const status = await fetchConnectionStatus(nextApps.map((app) => app.slug));
        if (!mounted) return;
        setConnected(
          Object.entries(status.services || {})
            .filter(([, value]) => value && value.connected)
            .map(([slug]) => slug),
        );
        if (status.error) setError(status.error);
      } else {
        setConnected([]);
      }

      if (mounted) setLoading(false);
    }

    loadMarketplace().catch((err) => {
      if (!mounted) return;
      setError(err.message || 'Could not load connector catalog');
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [refreshToken]);

  const toggle = async (app) => {
    if (busySlug) return;
    setNotice('');
    setError('');

    const isOn = connected.includes(app.slug);
    if (!configured) {
      onOpenSettings?.();
      setNotice('Add your connector key in Settings to connect an account.');
      return;
    }

    setBusySlug(app.slug);
    let authWindow = null;
    try {
      if (!isOn && typeof window !== 'undefined') {
        authWindow = window.open('', '_blank');
      }

      if (isOn) {
        await disconnectConnector(app.slug);
        setConnected((current) => current.filter((slug) => slug !== app.slug));
        setNotice(`${app.label} disconnected.`);
      } else {
        const result = await authorizeConnector(app.slug);
        if (!result.url) throw new Error('The connector did not return an authorization link');
        if (authWindow) {
          authWindow.location.href = result.url;
        } else if (typeof window !== 'undefined') {
          window.open(result.url, '_blank', 'noopener,noreferrer');
        }
        setNotice(`Authorization opened for ${app.label}. Refresh after completing it.`);
      }
    } catch (err) {
      if (authWindow && !authWindow.closed) authWindow.close();
      setError(err.message || `Could not update ${app.label}`);
    } finally {
      setBusySlug(null);
    }
  };

  const visible = apps.filter((app) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return `${app.label} ${app.slug} ${app.blurb}`.toLowerCase().includes(query);
  });

  return <AppPage title="Connected apps" description="Bring your tools into your Poka workspace." actions={<>
    <button className="icon-button" onClick={() => setRefreshToken(value => value + 1)} title="Refresh connections" aria-label="Refresh connections"><FiRefreshCw className={loading ? 'animate-spin' : ''} /></button>
    <button className="soft-button" onClick={onOpenSettings}><FiSettings /> Settings</button>
  </>}>
    <div className="app-toolbar">
      <label className="app-search"><FiSearch /><input aria-label="Search connected apps" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search apps" /></label>
      <span className="app-muted">{connected.length} connected</span>
    </div>
    {!configured && <div className="app-setup-row"><div className="app-feature-icon"><FiZap /></div><div><h3>Connect your first app</h3><p>Add a connector key, then securely sign in to the apps you use.</p></div><button className="primary-button" onClick={onOpenSettings}>Set up connections</button></div>}
    {(notice || error) && <p className={`app-notice ${error ? 'is-error' : ''}`} role="status">{error || notice}</p>}
    <div className="app-section-label">{search ? 'Search results' : 'Available apps'} <span>{visible.length}</span></div>
    <div className="connected-app-grid">
      {visible.map(app => {
        const isOn = connected.includes(app.slug);
        return <article className="connected-app-card" key={app.slug}>
          <div className="connected-app-heading"><div className="connected-app-icon"><AppIcon app={app} /></div>{isOn && <span className="app-status is-running"><span />Connected</span>}</div>
          <h3>{app.label}</h3><p>{app.blurb}</p>
          <button className={isOn ? 'soft-button' : 'app-connect-button'} disabled={Boolean(busySlug)} onClick={() => toggle(app)} aria-label={`${isOn ? 'Disconnect' : 'Connect'} ${app.label}`}>
            {busySlug === app.slug ? <><FiRefreshCw className="animate-spin" />Connecting…</> : isOn ? <><FiCheck /> Disconnect</> : <><FiPlus /> Connect</>}
          </button>
        </article>;
      })}
    </div>
    {!visible.length && <div className="app-empty"><FiSearch /><h3>No apps found</h3><p>Try a different name or search term.</p></div>}
  </AppPage>;
}

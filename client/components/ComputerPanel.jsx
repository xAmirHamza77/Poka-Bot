'use client';

import AppPage from './AppPage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FiActivity, FiSettings,
  FiAlertCircle,
  FiArrowLeft,
  FiCpu,
  FiHardDrive,
  FiMonitor,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiSquare,
  FiTerminal,
} from 'react-icons/fi';

import {
  runComputerAction, executeComputerAction, respondApproval,
  fetchComputerScreenshot,
  fetchComputerStatus,
  pauseComputer,
  resetComputer,
  startComputer,
  stopComputer,
} from '../lib/api';

const ACTIVE_STATES = new Set(['running', 'paused']);

function stateClasses(state) {
  if (state === 'running') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (state === 'paused') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  if (state === 'starting' || state === 'resetting') return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  return 'bg-slate-800 text-slate-300 border-slate-700';
}
function prettyState(state) {
  return (state || 'stopped').replace(/_/g, ' ');
}

export default function ComputerPanel({ bot, onBackToChat, onOpenSettings, onOpenNewBot }) {
  const [pending, setPending] = useState(null);
  const [output, setOutput] = useState(null);
  const [browserUrl,setBrowserUrl]=useState('');
  const [command,setCommand]=useState('');
  const [filePath,setFilePath]=useState('/workspace');
  const [inputText,setInputText]=useState('');
  const [pointerMode,setPointerMode]=useState('left');
  const [keyInput,setKeyInput]=useState('Enter');
  const [computer, setComputer] = useState(null);
  const [screen, setScreen] = useState(null);
  const [activeTab, setActiveTab] = useState('display');
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState('');
  const [error, setError] = useState('');

  const botId = bot?.id;
  const state = computer?.state || 'stopped';
  const isActive = ACTIVE_STATES.has(state);

  const refresh = useCallback(async (includeScreen = true) => {
    if (!botId) return;
    try {
      const statusPayload = await fetchComputerStatus(botId);
      const nextComputer = statusPayload.status;
      setComputer(nextComputer);
      if (includeScreen && ACTIVE_STATES.has(nextComputer.state)) {
        const screenPayload = await fetchComputerScreenshot(botId);
        setScreen(screenPayload.result || null);
      } else if (!ACTIVE_STATES.has(nextComputer.state)) {
        setScreen(null);
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Computer provider is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    let disposed = false;
    setPending(null); setOutput(null);
    setComputer(null);
    setScreen(null);
    setError('');
    setLoading(true);

    async function load() {
      if (!botId || disposed) return;
      try {
        const statusPayload = await fetchComputerStatus(botId);
        if (disposed) return;
        setComputer(statusPayload.status);
        if (ACTIVE_STATES.has(statusPayload.status.state)) {
          const screenPayload = await fetchComputerScreenshot(botId);
          if (!disposed) setScreen(screenPayload.result || null);
        }
      } catch (err) {
        if (!disposed) setError(err.message || 'Computer provider is unavailable.');
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    load();
    const interval = window.setInterval(() => {
      if (!disposed) refresh(true);
    }, 4000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [botId, refresh]);

  const runAction = async (name, operation) => {
    if (!botId) return;
    setLoadingAction(name);
    setError('');
    try {
      await operation(botId);
      await refresh(true);
    } catch (err) {
      setError(err.message || `Computer ${name} failed.`);
    } finally {
      setLoadingAction('');
    }
  };

  const runTool = async (action, args) => {
    if (pending || loadingAction) return;
    setLoadingAction(action); setError('');
    try { const result = await runComputerAction(botId, action, args); if (result.status === 'pending_approval') setPending(result.request); else { setOutput(result.result); await refresh(true); } }
    catch (failure) { setError(failure.message); } finally { setLoadingAction(''); }
  };
  const decide = async decision => {
    setLoadingAction('approval'); setError('');
    try { await respondApproval(pending.request_id, decision); if (decision === 'allow') { const result = await executeComputerAction(botId, pending.request_id); setOutput(result.result); } setPending(null); await refresh(true); }
    catch (failure) { setError(failure.message); } finally { setLoadingAction(''); }
  };
  const clickScreen = event => {
    const image=event.currentTarget, rect=image.getBoundingClientRect();
    const scale=Math.min(rect.width/image.naturalWidth, rect.height/image.naturalHeight);
    const left=rect.left+(rect.width-image.naturalWidth*scale)/2, top=rect.top+(rect.height-image.naturalHeight*scale)/2;
    const x=Math.floor((event.clientX-left)/scale), y=Math.floor((event.clientY-top)/scale);
    if (x>=0 && y>=0 && x<image.naturalWidth && y<image.naturalHeight) runTool('send_input',{event:{type:pointerMode==='double'?'double_click':'click',x,y,button:pointerMode==='right'?'right':'left'}});
  };
  const capabilities = useMemo(() => computer?.capabilities || [], [computer]);

  if (!bot) {
    return <AppPage title="Computer" description="Connect a desktop for Poka to work in" actions={<button className="soft-button" onClick={onOpenSettings}><FiSettings /> Remote connection</button>}><div className="app-empty"><FiMonitor /><h3>Set up your computer</h3><p>Connect a Windows server, then create an assistant to start working.</p><button className="primary-button" onClick={onOpenNewBot}>Create assistant</button></div></AppPage>;
  }

  const actionBusy = Boolean(loadingAction);

  return <AppPage title="Computer" description={`${bot.name || 'Your assistant'}’s workspace`} className="computer-app-page" actions={<>
    <span className={`app-status is-${state}`}><span />{prettyState(state)}</span>
    <button className="soft-button" onClick={onBackToChat}><FiArrowLeft /> Back to chat</button>
  </>}>
    <div className="app-toolbar">
      <div className="app-segments" role="group" aria-label="Computer view">{[['display', 'Display'], ['tools', 'Tools'], ['activity', 'Activity']].map(([tab, label]) => <button key={tab} aria-pressed={activeTab === tab} className={activeTab === tab ? 'selected' : ''} onClick={() => setActiveTab(tab)}>{label}</button>)}</div>
      <div className="app-page-actions"><button className="soft-button" onClick={onOpenSettings}><FiSettings /> Remote connection</button>
        {state === 'running' ? <button className="soft-button" disabled={actionBusy} onClick={() => runAction('pause', pauseComputer)}><FiPause />{loadingAction === 'pause' ? 'Pausing…' : 'Pause'}</button> : <button className="primary-button" disabled={actionBusy || loading || state === 'starting' || state === 'resetting'} onClick={() => runAction('start', startComputer)}><FiPlay />{loadingAction === 'start' ? 'Starting…' : state === 'paused' ? 'Resume' : 'Start computer'}</button>}
        <button className="icon-button" aria-label="Reset computer" title="Reset computer" disabled={actionBusy || loading} onClick={() => runAction('reset', resetComputer)}><FiRefreshCw className={loadingAction === 'reset' ? 'animate-spin' : ''} /></button>
        <button className="icon-button" aria-label="Stop computer" title="Stop computer" disabled={actionBusy || !isActive} onClick={() => runAction('stop', stopComputer)}><FiSquare /></button>
      </div>
    </div>
    {pending && <div className="computer-approval" role="region" aria-label="Approve computer action"><strong>Allow this computer action?</strong><p>{pending.preview}</p><pre>{JSON.stringify(pending.arguments, null, 2)}</pre><div className="flex gap-3"><button className="soft-button" disabled={actionBusy} onClick={() => decide('deny')}>Deny</button><button className="primary-button" disabled={actionBusy} onClick={() => decide('allow')}>Allow</button></div></div>}
    {activeTab === 'tools' && <div className="computer-tools">
      <form onSubmit={event=>{event.preventDefault();runTool('browser_navigate',{url:browserUrl});}}><label>Browser address<input type="url" required value={browserUrl} onChange={event=>setBrowserUrl(event.target.value)} className="settings-input" placeholder="https://example.com" /></label><button className="soft-button" disabled={!isActive || actionBusy || Boolean(pending)}>Open</button></form>
      <form onSubmit={event=>{event.preventDefault();runTool('terminal_execute',{command});}}><label>Terminal command<textarea required value={command} onChange={event=>setCommand(event.target.value)} className="settings-input" placeholder="Get-Location" /></label><button className="soft-button" disabled={!isActive || actionBusy || Boolean(pending)}>Run</button></form>
      <form onSubmit={event=>{event.preventDefault();runTool('files_list',{path:filePath});}}><label>Workspace folder<input required value={filePath} onChange={event=>setFilePath(event.target.value)} className="settings-input" /></label><button className="soft-button" disabled={!isActive || actionBusy || Boolean(pending)}>List files</button></form>
      <form onSubmit={event=>{event.preventDefault();runTool('send_input',{event:{type:'type',text:inputText}});}}><label>Type into desktop<textarea required value={inputText} onChange={event=>setInputText(event.target.value)} className="settings-input" /></label><button className="soft-button" disabled={state !== 'running' || actionBusy || Boolean(pending)}>Type text</button></form>
      <form onSubmit={event=>{event.preventDefault();runTool('send_input',{event:{type:'keypress',key:keyInput}});}}><label>Keyboard shortcut<input required value={keyInput} onChange={event=>setKeyInput(event.target.value)} className="settings-input" placeholder="Control+L" /></label><button className="soft-button" disabled={state !== 'running' || actionBusy || Boolean(pending)}>Press keys</button></form>
      <div className="flex gap-3 items-center flex-wrap"><label className="text-sm">Desktop click<select className="settings-input mt-2" value={pointerMode} onChange={event=>setPointerMode(event.target.value)}><option value="left">Left click</option><option value="right">Right click</option><option value="double">Double click</option></select></label><button className="soft-button" disabled={state !== 'running' || actionBusy || Boolean(pending)} onClick={()=>runTool('send_input',{event:{type:'scroll',delta_y:3}})}>Scroll up</button><button className="soft-button" disabled={state !== 'running' || actionBusy || Boolean(pending)} onClick={()=>runTool('send_input',{event:{type:'scroll',delta_y:-3}})}>Scroll down</button><button className="soft-button" disabled={actionBusy || Boolean(pending)} onClick={()=>runTool('cleanup',{})}>Remove computer session</button></div>
      {output && <pre className="computer-tool-output" aria-live="polite">{JSON.stringify(output,null,2)}</pre>}
    </div>}
    {error && <p className="app-notice is-error" role="alert"><FiAlertCircle />{error}</p>}
    <div className="computer-workspace">
      <div className="computer-display">
        <div className="computer-display-bar"><span><FiMonitor /> {activeTab === 'display' ? 'Desktop' : 'Recent activity'}</span><span>{computer?.width || 1280} × {computer?.height || 720}</span></div>
        <div className="computer-screen">
          {activeTab === 'activity' ? <div className="computer-activity-list">{[['State', prettyState(state)], ['Health', computer?.health || 'Unknown'], ['Last action', computer?.last_operation || 'None'], ['Last frame', screen?.frame_id || 'No frame']].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : screen?.available && screen?.data ? <img onClick={state === 'running' ? clickScreen : undefined} title="Click the desktop to request a pointer action" src={`data:image/${screen.format || 'jpeg'};base64,${screen.data}`} alt={`${bot.name}'s computer display`} /> : <div className="app-empty"><div className="computer-empty-icon"><FiMonitor /></div><h3>{loading ? 'Connecting to your computer…' : isActive ? 'Computer is running' : 'Your computer is ready'}</h3><p>{isActive ? screen?.message || 'Waiting for a live display from your computer provider.' : 'Start a computer for your assistant to work in.'}</p>{computer?.provider === 'fake' && <span className="computer-demo-note">Demo provider · Configure a real runtime to see a live desktop.</span>}{!isActive && !loading && <button className="primary-button" disabled={actionBusy} onClick={() => runAction('start', startComputer)}><FiPlay />Start computer</button>}</div>}
        </div>
      </div>
      <aside className="computer-inspector">
        <div className="app-section-label">Computer details</div>
        <dl>{[['Provider', computer?.provider === 'fake' ? 'Demo' : computer?.provider || 'Not configured'], ['Status', prettyState(state)], ['Health', computer?.health || 'Unknown'], ['Frame rate', `${computer?.fps || 30} fps`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="app-section-label">Available tools</div>
        <div className="computer-capabilities">{capabilities.map(capability => <span key={capability}>{capability.replaceAll('_', ' ')}</span>)}{!capabilities.length && <p className="app-muted">Tools appear when a provider is connected.</p>}</div>
        <p className="computer-inspector-note">Windows agents share a desktop and require an unlocked session for display and input.</p><p className="computer-inspector-note"><FiHardDrive />Computer actions appear in your audit trail.</p>
      </aside>
    </div>
  </AppPage>;
}

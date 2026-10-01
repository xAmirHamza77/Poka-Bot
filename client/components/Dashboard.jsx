'use client';
import { useState, useEffect } from 'react';
import { FiSidebar } from 'react-icons/fi';
import { readAppearance, normalizeAppearance, appearanceStyle, DEFAULT_APPEARANCE, APPEARANCE_KEY } from '../lib/appearance.mjs';
import Sidebar from './Sidebar';
import ChatWindow from './ChatWindow';
import ComputerPanel from './ComputerPanel';
import Marketplace from './Marketplace';
import AuditPanel from './AuditPanel';
import SettingsPage from './SettingsPage';
import NewAssistantModal from './NewAssistantModal';
import { GoalsPanel, ArtifactsPanel, SearchPanel } from './WorkspacePanels';
import { fetchBots, fetchModels, fetchChatHistory, fetchSettings, createBot, updateBot } from '../lib/api';

export default function Dashboard() {
  const [appearance, setAppearance] = useState({ ...DEFAULT_APPEARANCE });
  const [appearanceNotice, setAppearanceNotice] = useState('');
  const [settingsSection, setSettingsSection] = useState('appearance');
  const openSettings = (section = 'appearance') => { setSettingsSection(section); setSettingsOpen(true); };
  const updateAppearance = value => { const next = normalizeAppearance(value); setAppearance(next); try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next)); setAppearanceNotice(''); } catch { setAppearanceNotice('Changes apply now, but could not be saved on this device.'); } };
  useEffect(() => { setAppearance(readAppearance(localStorage)); const sync = event => { if (event.key === APPEARANCE_KEY) setAppearance(readAppearance(localStorage)); }; window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync); }, []);
  const [bots, setBots] = useState([]);
  const [models, setModels] = useState([]);
  const [activeBotId, setActiveBotId] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newAssistant, setNewAssistant] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [defaultModel, setDefaultModel] = useState('gpt-5-mini');
  const [userName, setUserName] = useState('You');
  const [notice, setNotice] = useState('');
  const [providerReady, setProviderReady] = useState(false);
  useEffect(() => {
    setUserName(localStorage.getItem('poka_user_name') || 'You');
    let cancelled = false;
    Promise.all([fetchBots(), fetchModels(), fetchSettings()]).then(([botData, modelData, settings]) => {
      if (cancelled) return;
      setBots(botData); setModels(modelData);
      if (settings?.default_model) setDefaultModel(settings.default_model);
      if (botData.length) setActiveBotId(botData[0].id);
      setProviderReady(Boolean(settings?.model_api_base_url));
      if (settings && !settings.model_api_base_url) openSettings('provider');
    }).catch(() => setNotice('Could not load the workspace. Please reconnect and retry.'));
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const shortcuts = event => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === ',') { event.preventDefault(); setSettingsSection('appearance'); setSettingsOpen(value => !value); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSettingsOpen(false); setActiveTab('search'); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setNewAssistant(true); }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, []);
  const activeBot = bots.find(b => b.id === activeBotId);
  const selectBot = id => { setSettingsOpen(false); setActiveBotId(id); setActiveTab('chat'); };
  const refreshProvider = async model => {
    setDefaultModel(model); setModels(await fetchModels());
    if (!providerReady && activeBotId) {
      try { const updated = await updateBot(activeBotId, { model }); setBots(prev => prev.map(b => b.id === updated.id ? updated : b)); }
      catch { setNotice('Provider saved. Select the new model in the chat header to use it.'); }
    }
    setProviderReady(true);
  };
  return <div className="desktop-workspace" style={appearanceStyle(appearance)} data-chat-design={appearance.design} data-show-times={appearance.timestamps} data-reduced-motion={appearance.reducedMotion}>
    <Sidebar bots={bots} activeBotId={activeBotId} userName={userName} activeTab={settingsOpen ? 'settings' : activeTab} onSelectBot={selectBot} onSelectTab={tab => { setSettingsOpen(false); setActiveTab(tab); }} onOpenSettings={() => openSettings()} onOpenModelSettings={() => openSettings('provider')} onOpenNewBot={() => setNewAssistant(true)} expanded={expanded} onToggleSidebar={() => setExpanded(value => !value)} />
    <main className="workspace-main">
      <div className="workspace-titlebar" aria-hidden="true" />
      {notice && <div role="alert" className="workspace-notice">{notice}</div>}
      {settingsOpen ? <SettingsPage appearance={appearance} onAppearanceChange={updateAppearance} appearanceNotice={appearanceNotice} initialSection={settingsSection} models={models} isOpen onClose={() => setSettingsOpen(false)} currentModel={defaultModel} onUpdateDefaultModel={refreshProvider} onProfileUpdate={name => setUserName(name || 'You')} /> : <>
      {activeTab === 'chat' && <ChatWindow appearance={appearance} key={activeBotId || 'empty'} bot={activeBot} models={models} messages={messages} setMessages={setMessages} defaultModel={defaultModel} providerReady={providerReady} onOpenSettings={() => openSettings('provider')} onOpenNewBot={() => setNewAssistant(true)} expanded={expanded} onToggleSidebar={() => setExpanded(value => !value)} onUpdateBotColor={async (id, accent_color) => { const updated = await updateBot(id, { accent_color }); setBots(prev => prev.map(bot => bot.id === id ? updated : bot)); }} onUpdateBotModel={async (id, model) => { try { const updated = await updateBot(id, { model }); setBots(prev => prev.map(b => b.id === id ? updated : b)); } catch { setNotice('Could not change the assistant model. Please retry.'); } }} onToggleComputer={() => setActiveTab('computer')} />}
      {activeTab === 'goals' && <GoalsPanel />}
      {activeTab === 'artifacts' && <ArtifactsPanel />}
      {activeTab === 'search' && <SearchPanel bots={bots} onSelectBot={selectBot} />}
      {activeTab === 'computer' && <ComputerPanel onOpenNewBot={() => setNewAssistant(true)} onOpenSettings={() => openSettings('computer')} bot={activeBot} onBackToChat={() => setActiveTab('chat')} />}
      {activeTab === 'marketplace' && <Marketplace onOpenSettings={() => openSettings('provider')} />}
      {activeTab === 'audit' && <AuditPanel bots={bots} />}
      </>}
    </main>

    {newAssistant && <NewAssistantModal models={models} defaultModel={defaultModel} onClose={() => setNewAssistant(false)} onCreate={async data => { const bot = await createBot(data); setBots(prev => [...prev, bot]); selectBot(bot.id); }} />}
  </div>;
}

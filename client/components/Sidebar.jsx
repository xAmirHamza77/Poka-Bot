'use client';
import { useState } from 'react';
import { FiMessageCircle, FiSearch, FiCheckSquare, FiGrid, FiMenu, FiPlus, FiSettings, FiMonitor, FiActivity, FiBox, FiSidebar } from 'react-icons/fi';
import BrandIcon from './BrandIcon';
import MascotAvatar, { getAvatarType } from './MascotAvatar';

const destinations = [
  ['chat', 'Chats', FiMessageCircle], ['search', 'Search chats', FiSearch],
  ['goals', 'Goals', FiCheckSquare], ['artifacts', 'Artifacts', FiGrid],
  ['marketplace', 'Plugins', FiBox], ['computer', 'Computer', FiMonitor], ['audit', 'Activity', FiActivity],
];
export default function Sidebar({ bots = [], activeBotId, userName, onSelectBot, activeTab, onSelectTab, onOpenSettings, onOpenModelSettings, onOpenNewBot, expanded, onToggleSidebar }) {
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const filtered = bots.filter(bot => `${bot.name} ${bot.role}`.toLowerCase().includes(search.toLowerCase()));
  const showChats = expanded && activeTab === 'chat';
  return <>
    <nav className="workspace-rail" aria-label="Main navigation">
      <div className="rail-window-space" />
      <button className="rail-brand" onClick={() => onSelectTab('chat')} title="Poka" aria-label="Poka"><BrandIcon className="h-11 w-11" /></button>
      <div className="rail-destinations">
        {destinations.map(([id, label, Icon]) => <button key={id} title={label} aria-label={label} aria-current={activeTab === id || (id === 'search' && activeTab === 'search') ? 'page' : undefined} className={`rail-button ${activeTab === id ? 'active' : ''}`} onClick={() => { onSelectTab(id); setMenuOpen(false); }}><Icon /></button>)}
      </div>
      <div className="relative mt-auto">
        {menuOpen && <div className="rail-menu">
          <p className="px-3 pb-3 text-xs text-zinc-500">{userName || 'Your workspace'}</p>
          <button onClick={() => { onOpenSettings(); setMenuOpen(false); }}><FiSettings /> Settings <span>⌘ ,</span></button>
          <button onClick={() => { onOpenModelSettings(); setMenuOpen(false); }}><FiBox /> Custom model setup</button>
        </div>}
        <button className={`rail-button ${menuOpen ? 'active' : ''}`} aria-label="Workspace menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><FiMenu /></button>
      </div>
    </nav>
    {showChats && <aside className="chat-sidebar">
      <div className="flex items-center justify-between mb-5"><h2 className="font-medium text-lg">Chats</h2><div className="flex gap-1"><button className="icon-button" onClick={onOpenNewBot} aria-label="Create assistant" title="Create assistant"><FiPlus /></button><button className="icon-button" onClick={onToggleSidebar} aria-label="Hide chat list" title="Hide chat list"><FiSidebar /></button></div></div>
      <label className="sidebar-search"><FiSearch /><input placeholder="Search" aria-label="Search assistants" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <p className="sidebar-label">Your assistants</p>
      <div className="flex-1 overflow-y-auto space-y-1">
        {filtered.map((bot, index) => <button key={bot.id} className={`assistant-row ${bot.id === activeBotId ? 'selected' : ''}`} onClick={() => onSelectBot(bot.id)} aria-pressed={bot.id === activeBotId}><MascotAvatar type={getAvatarType(bot)} /><span className="min-w-0 text-left"><span className="block truncate text-sm font-medium text-zinc-100">{bot.name}</span><span className="block truncate mt-1 text-xs text-zinc-500">{bot.role || 'AI assistant'}</span></span></button>)}
        {!filtered.length && <div className="sidebar-empty"><FiMessageCircle className="mx-auto mb-4 text-3xl" /><h3>{search ? 'No matching chats' : 'Start something new'}</h3><p>{search ? 'Try a different name or role.' : 'Give each project its own assistant and conversation.'}</p>{!search && <button className="soft-button mt-5" onClick={onOpenNewBot}>New assistant</button>}</div>}
      </div>
      <button className="sidebar-config" onClick={onOpenModelSettings}><FiSettings /><span>Custom model setup</span></button>
    </aside>}
  </>;
}

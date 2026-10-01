'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { FiChevronDown, FiCheck } from 'react-icons/fi';

// ─── Shared model catalog (single source of truth) ─────────────────────────
export const ALL_PROVIDERS = [{ id: 'configured', name: 'Configured models', icon: '✦', color: '#60a5fa', models: [] }];

// Helper — find provider + model object by model ID
export function getProviders(models) {
  if (!models?.length) return ALL_PROVIDERS;
  const groups = new Map();
  for (const model of models) {
    if (model.is_available === false) continue;
    const name = model.provider || 'Configured provider';
    if (!groups.has(name)) {
      groups.set(name, { id: name, name, icon: '✦', color: '#a78bfa', models: [] });
    }
    groups.get(name).models.push({ ...model, tag: model.recommended ? 'Recommended' : undefined });
  }
  return groups.size ? [...groups.values()] : ALL_PROVIDERS;
}

export function findModel(modelId, providers = ALL_PROVIDERS) {
  for (const provider of providers) {
    const found = provider.models.find((m) => m.id === modelId);
    if (found) return { provider, model: found };
  }
  return null;
}

// ─── ModelPicker (chat header) ─────────────────────────────────────────────
export default function ModelPicker({ currentModel, onSelectModel, models }) {
  const providers = useMemo(() => getProviders(models), [models]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('assistant');
  const dropdownRef = useRef(null);

  // Auto-switch provider tab to match the currently selected model
  useEffect(() => {
    const found = findModel(currentModel, providers);
    if (found) setActiveTab(found.provider.id);
  }, [currentModel, providers]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeProvider = providers.find((p) => p.id === activeTab) || providers[0];
  const currentInfo = findModel(currentModel, providers);
  const displayName = currentInfo?.model?.name || currentModel || 'Select Model';
  const displayIcon = currentInfo?.provider?.icon || 'Ø';
  const displayColor = currentInfo?.provider?.color || '#a78bfa';

  return (
    <div className="relative z-50" ref={dropdownRef} suppressHydrationWarning={true}>
      {/* Trigger Button */}
      <button
        suppressHydrationWarning={true}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#303030] hover:bg-[#3a3a3a] border border-[#383838] text-xs text-zinc-200 transition shadow-sm font-medium"
      >
        <span className="font-bold text-[11px]" style={{ color: displayColor }}>{displayIcon}</span>
        <span className="font-medium text-zinc-200 max-w-[130px] truncate">{displayName}</span>
        <FiChevronDown
          className={`text-zinc-400 text-xs transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Floating Popover */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-[320px] rounded-2xl shadow-2xl border border-[#2c2c34] z-50 flex overflow-hidden animate-fade-in"
          style={{ background: '#141417' }}
          suppressHydrationWarning={true}
        >
          {/* Left Provider Rail */}
          <div className="w-12 bg-[#101013] border-r border-[#26262b] flex flex-col items-center py-3 gap-1.5 flex-shrink-0">
            {providers.map((tab) => {
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  suppressHydrationWarning={true}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.name}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-all"
                  style={
                    isSelected
                      ? {
                          background: `${tab.color}20`,
                          color: tab.color,
                          boxShadow: `0 0 0 1px ${tab.color}40`,
                        }
                      : { color: '#71717a' }
                  }
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.color = '#e4e4e7';
                      e.currentTarget.style.background = '#1f1f23';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.color = '#71717a';
                      e.currentTarget.style.background = '';
                    }
                  }}
                >
                  {tab.icon}
                </button>
              );
            })}
          </div>

          {/* Right Model List */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Provider Header */}
            <div className="px-3.5 pt-3.5 pb-2 border-b border-[#1e1e22] flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base" style={{ color: activeProvider.color }}>
                  {activeProvider.icon}
                </span>
                <h4 className="text-xs font-bold text-white tracking-wide">{activeProvider.name}</h4>
              </div>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                {activeProvider.models.length} models available
              </p>
            </div>

            {/* Scrollable Model List */}
            <div className="overflow-y-auto max-h-[260px] p-2 space-y-0.5" style={{ scrollbarWidth: 'thin', scrollbarColor: '#27272a transparent' }}>
              {!activeProvider.models.length && <p className="px-3 py-4 text-xs text-zinc-400">Add model IDs in Settings → Custom model setup.</p>}
              {activeProvider.models.map((model) => {
                const isSelected = currentModel === model.id;
                return (
                  <button
                    type="button"
                    key={model.id}
                    onClick={() => {
                      onSelectModel(model.id);
                      setIsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl cursor-pointer transition-all flex items-center justify-between text-xs"
                    style={
                      isSelected
                        ? {
                            background: `${activeProvider.color}1a`,
                            color: activeProvider.color,
                            fontWeight: 600,
                          }
                        : { color: '#a1a1aa' }
                    }
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = '#1e1e23';
                        e.currentTarget.style.color = '#e4e4e7';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.color = '#a1a1aa';
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{model.name}</span>
                      {model.tag && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{
                            background: `${activeProvider.color}22`,
                            color: activeProvider.color,
                          }}
                        >
                          {model.tag}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <FiCheck className="flex-shrink-0 ml-2 text-sm" style={{ color: activeProvider.color }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

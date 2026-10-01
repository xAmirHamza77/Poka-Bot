"use client";

import React, { useState, useEffect } from "react";
import { FiArrowLeft, FiSliders, FiMonitor, FiInfo, FiCpu, FiBox, FiUser, FiServer, FiEye, FiEyeOff, FiPlus, FiTrash2 } from "react-icons/fi";
import { getDesktop, fetchSettings, saveSettings, testProviderConnection } from "../lib/api";

import ComputerSettings from "./ComputerSettings";
import AppearanceSettings from "./AppearanceSettings";
import BrandIcon from "./BrandIcon";

const inputClass = "settings-input";
const cardClass = "settings-group space-y-4";
const buttonClass = "primary-button settings-save";

export default function SettingsPage({ appearance, onAppearanceChange, appearanceNotice, initialSection = "appearance", models, isOpen, onClose, currentModel, onUpdateDefaultModel, onProfileUpdate }) {
  const [computerConfig, setComputerConfig] = useState(null);
  const [serverUrl, setServerUrl] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [wireApi, setWireApi] = useState("responses");
  const [apiKey, setApiKey] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [modelIds, setModelIds] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [headersConfigured, setHeadersConfigured] = useState(false);
  const [headersMode, setHeadersMode] = useState("keep");
  const [headers, setHeaders] = useState([{ name: "", value: "" }]);
  const [composioKey, setComposioKey] = useState("");
  const [composioConfigured, setComposioConfigured] = useState(false);
  const [checking, setChecking] = useState(false);
  const [activeSection, setActiveSection] = useState(initialSection);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [connectorNotice, setConnectorNotice] = useState(null);

  useEffect(() => { setActiveSection(initialSection); }, [initialSection]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setServerUrl(getDesktop()?.serverUrl || "");
    setLoaded(false);
    setNotice(null);
    setConnectorNotice(null);
    setApiKey("");
    setComposioKey("");
    setShowKey(false);
    setUserName(localStorage.getItem("poka_user_name") || "");
    setUserEmail(localStorage.getItem("poka_user_email") || "");
    fetchSettings().then((data) => {
      if (cancelled) return;
      if (!data) {
        setNotice({ error: true, text: "Could not load settings. Reopen Settings to retry." });
        return;
      }
      setComputerConfig(data);
      setBaseUrl(data.model_api_base_url || "");
      setWireApi(data.model_api_base_url ? data.model_api_wire_api || "prediction" : "chat_completions");
      setKeyConfigured(Boolean(data.model_api_key_configured));
      setModelIds((data.model_ids || []).join("\n"));
      setDefaultModel(data.default_model || currentModel || "gpt-5-mini");
      setHeadersConfigured(Boolean(data.model_api_headers_configured));
      setHeadersMode("keep");
      setHeaders([{ name: "", value: "" }]);
      setComposioConfigured(Boolean(data.composio_api_key_configured));
      setLoaded(true);
    });
    return () => { cancelled = true; };
    // Reload when opening, without overwriting a draft when the active model changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const saveProvider = async (event) => {
    event.preventDefault();
    setNotice(null);
    setSaving(true);
    try {
      const url = new URL(baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Enter an http(s) API base URL without credentials, query parameters, or fragments.");
      }
      const selectedModel = defaultModel.trim();
      if (!selectedModel) throw new Error("Enter a default model ID.");
      const ids = [...new Set([...modelIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean), selectedModel])];
      const payload = {
        model_api_base_url: baseUrl.trim().replace(/\/+$/, ""),
        model_api_wire_api: wireApi,
        model_api_key: apiKey.trim(),
        model_ids: ids,
        default_model: selectedModel,
      };
      if (headersMode === "replace") {
        const entries = headers.map(({ name, value }) => [name.trim(), value]);
        if (!entries.length || entries.some(([name, value]) => !name || !value)) {
          throw new Error("Fill in a name and value for each header, or select Remove all.");
        }
        if (new Set(entries.map(([name]) => name.toLowerCase())).size !== entries.length) {
          throw new Error("Each custom header must have a unique name.");
        }
        payload.model_api_headers = Object.fromEntries(entries);
      } else if (headersMode === "remove") {
        payload.clear_model_api_headers = true;
      }
      const saved = await saveSettings(payload);
      setBaseUrl(saved.model_api_base_url);
      setApiKey("");
      setShowKey(false);
      setKeyConfigured(Boolean(saved.model_api_key_configured));
      setHeadersConfigured(Boolean(saved.model_api_headers_configured));
      setHeadersMode("keep");
      setHeaders([{ name: "", value: "" }]);
      setModelIds(saved.model_ids.join("\n"));
      setDefaultModel(saved.default_model);
      await onUpdateDefaultModel?.(saved.default_model);
      setNotice({ text: "Provider settings saved. Model menus updated." });
    } catch (error) {
      setNotice({ error: true, text: error.message || "Could not save provider settings." });
    } finally {
      setSaving(false);
    }
  };

  const saveConnector = async (event) => {
    event.preventDefault();
    setSaving(true);
    setConnectorNotice(null);
    try {
      const saved = await saveSettings({ composio_api_key: composioKey.trim() });
      setComposioKey("");
      setComposioConfigured(Boolean(saved.composio_api_key_configured));
      setConnectorNotice({ text: "Connector key saved." });
    } catch (error) {
      setConnectorNotice({ error: true, text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="App Settings" className="settings-page">
      <header className="app-page-header"><div><h1>Settings</h1><p>Make Poka your own</p></div><button onClick={onClose} className="soft-button" aria-label="Back to workspace"><FiArrowLeft /> Back</button></header>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings categories">{[["appearance", "Appearance", FiSliders], ["provider", "Models", FiCpu], ["connectors", "Connected apps", FiBox], ["profile", "Profile", FiUser], ["computer", "Computer", FiMonitor], ["server", "Server", FiServer], ["about", "About Poka", FiInfo]].map(([id, title, Icon]) => <button key={id} onClick={() => setActiveSection(id)} aria-current={activeSection === id ? "page" : undefined} className={activeSection === id ? "active" : ""}><Icon />{title}</button>)}</nav>
        <div className="settings-content"><div className="settings-content-inner">
        {activeSection === "appearance" && <><AppearanceSettings appearance={appearance} onChange={onAppearanceChange} />{appearanceNotice && <p role="alert" className="text-sm text-red-400 mt-3">{appearanceNotice}</p>}</>}
        {activeSection === "about" && <section className={`${cardClass} about-poka`}><BrandIcon className="h-24 w-24 mx-auto" /><h2>Poka</h2><p className="settings-description">Your personal AI workspace</p><dl><div><dt>App version</dt><dd>{getDesktop()?.version || process.env.NEXT_PUBLIC_POKA_VERSION || "Development"}</dd></div><div><dt>Interface version</dt><dd>{process.env.NEXT_PUBLIC_POKA_VERSION || "Development"}</dd></div><div><dt>Platform</dt><dd>{getDesktop()?.platform === 'darwin' ? 'macOS' : getDesktop()?.platform === 'win32' ? 'Windows' : 'Web'}</dd></div><div><dt>Workspace</dt><dd>{getDesktop() && !getDesktop().remote ? 'On this device' : 'Hosted server'}</dd></div></dl><p className="settings-description">Chat with your models, connect your apps, and keep your work together.</p></section>}
        {activeSection === "computer" && (computerConfig ? <ComputerSettings connection={computerConfig.computer_connection} url={computerConfig.computer_remote_url} configured={computerConfig.computer_remote_token_configured} loaded={loaded} onSaved={setComputerConfig} /> : <p role="status">{notice?.text || 'Loading computer settings…'}</p>)}
        {activeSection === "server" && <div className={cardClass}>
          <h3 className="text-base font-semibold">Always available Poka</h3>
          <p className="text-sm text-zinc-400">A hosted server keeps submitted jobs running when you close the app. Reopen the chat to restore progress. Actions that need approval still wait for your response.</p>
          {typeof window !== 'undefined' && getDesktop() ? <>
            <label className="block text-xs text-zinc-400">Server address<input className={`${inputClass} mt-2`} placeholder="https://your-server:8443" value={serverUrl} onChange={event => setServerUrl(event.target.value)} /></label>
            <p className="text-xs text-zinc-500">Connecting restarts Poka. Sign in with the server owner token and configure your model there. Your local workspace stays on this device.</p>
            <button className={buttonClass} disabled={!serverUrl} onClick={async () => { try { await getDesktop().connectServer(serverUrl.trim()); } catch (error) { setNotice({ error: true, text: error.message }); } }}>Connect and restart</button>
            {getDesktop().remote && <button className="soft-button ml-2" onClick={() => getDesktop().connectServer(null)}>Use local workspace</button>}
          </> : <p className="text-sm text-blue-300">Connected to {typeof window !== 'undefined' ? window.location.origin : 'this server'}. Jobs continue here after you close this window.</p>}
          {notice && <p role={notice.error ? "alert" : "status"} className="text-sm text-red-400">{notice.text}</p>}
        </div>}
        {activeSection === "provider" && <section className={cardClass}>
          <div><h2>Custom model setup</h2><p className="settings-description">Choose the provider and models Poka uses.</p></div>
          <form onSubmit={saveProvider} onChange={() => setNotice(null)} className="space-y-4 border-t border-[#27272a] pt-4">
          <p className="text-xs leading-6 text-zinc-400">Connect your own provider or a local model server. This configuration is shared by all assistants. Credentials are encrypted in your workspace.</p>
          {!loaded && !notice && <p role="status" className="text-xs text-zinc-400">Loading settings…</p>}
          <fieldset disabled={!loaded || saving || checking} className="space-y-4 disabled:opacity-60">
            <div className="space-y-1.5"><label className="block text-xs font-medium" htmlFor="provider-template">Start with a template</label><select id="provider-template" defaultValue="custom" className={inputClass} onChange={e => { if (e.target.value === "ollama") { setBaseUrl("http://localhost:11434/v1"); setWireApi("chat_completions"); } else if (e.target.value === "lmstudio") { setBaseUrl("http://localhost:1234/v1"); setWireApi("chat_completions"); } }}><option value="custom">Custom endpoint</option><option value="ollama">Ollama · local server</option><option value="lmstudio">LM Studio · local server</option></select><p className="text-[11px] text-zinc-500">Start your local server separately and enter its exact installed model ID.</p></div>
            <div className="space-y-1.5">
              <label htmlFor="provider-url" className="block text-xs font-medium">API Base URL</label>
              <input id="provider-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-provider.example/v1" className={inputClass} />
              <p className="text-[11px] text-zinc-500">Enter the API root, usually ending in /v1. Do not append /responses or /chat/completions.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="provider-protocol" className="block text-xs font-medium">API protocol</label>
              <select id="provider-protocol" value={wireApi} onChange={(e) => setWireApi(e.target.value)} className={inputClass}>
                <option value="chat_completions">Chat Completions · compatible providers</option>
                <option value="responses">Responses API</option>
                <option value="prediction">Prediction API (original adapter)</option>
              </select>
              <p className="text-[11px] text-zinc-500">{wireApi === "responses" ? "Uses /responses. Images and conversation history are included." : wireApi === "chat_completions" ? "Uses /chat/completions. Supports compatible remote APIs and local model servers." : "Uses /{model_id} and prediction polling with x-api-key authentication."}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="provider-key" className="block text-xs font-medium">Inference API Key</label>
              <div className="relative">
                <input id="provider-key" type={showKey ? "text" : "password"} autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyConfigured ? "Stored securely — leave blank to keep" : "API key (optional for local servers)"} className={`${inputClass} pr-10`} />
                <button type="button" title={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey(!showKey)} className="absolute right-3 top-3 text-zinc-400">{showKey ? <FiEyeOff /> : <FiEye />}</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="provider-models" className="block text-xs font-medium">Model IDs</label>
              <textarea id="provider-models" rows={3} value={modelIds} onChange={(e) => setModelIds(e.target.value)} placeholder="One model ID per line" className={`${inputClass} font-mono resize-y`} />
              <p className="text-[11px] text-zinc-500">Use exact IDs from your provider, separated by lines or commas.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="provider-default-model" className="block text-xs font-medium">Default model ID</label>
              <input id="provider-default-model" required value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} list="provider-model-options" className={inputClass} />
              <datalist id="provider-model-options">{[...new Set([...modelIds.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean), ...(models || []).map((model) => model.id)])].map((id) => <option key={id} value={id} />)}</datalist>
              <p className="text-[11px] text-zinc-500">Used for new assistants. Existing assistants keep their selected model.</p>
            </div>
            <details className="border border-[#36363d] rounded-lg p-3">
              <summary className="cursor-pointer text-xs font-medium">Custom headers · {headersConfigured ? "Configured" : "Optional"}</summary>
              <div className="mt-3 space-y-3">
                <label htmlFor="provider-header-action" className="block text-xs text-zinc-400">Header action</label>
                <select id="provider-header-action" value={headersMode} onChange={(e) => setHeadersMode(e.target.value)} className={inputClass}>
                  <option value="keep">Keep stored headers</option>
                  <option value="replace">Replace all headers</option>
                  <option value="remove">Remove all headers</option>
                </select>
                <p className="text-[11px] text-zinc-500">Values are encrypted and never shown after saving. Replace all requires the complete set.</p>
                {headersMode === "replace" && <>
                  {headers.map((header, index) => <div key={index} className="space-y-2 rounded-lg bg-[#111113] p-2">
                    <input aria-label={`Header name ${index + 1}`} value={header.name} onChange={(e) => setHeaders(headers.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} placeholder="Header name" className={inputClass} />
                    <div className="flex gap-2">
                      <input aria-label={`Header value ${index + 1}`} type="password" autoComplete="new-password" value={header.value} onChange={(e) => setHeaders(headers.map((row, i) => i === index ? { ...row, value: e.target.value } : row))} placeholder="Header value" className={inputClass} />
                      <button type="button" title={`Remove header ${index + 1}`} onClick={() => setHeaders(headers.filter((_, i) => i !== index))} className="p-2 text-zinc-400 hover:text-red-400"><FiTrash2 /></button>
                    </div>
                  </div>)}
                  <button type="button" onClick={() => setHeaders([...headers, { name: "", value: "" }])} className="flex items-center gap-1 text-xs text-blue-300"><FiPlus /> Add header</button>
                </>}
              </div>
            </details>
            <button type="submit" className={`${buttonClass} w-full`}>{saving ? "Saving…" : "Save configuration"}</button>
            <button type="button" className="w-full rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800" onClick={async () => { setChecking(true); setNotice(null); try { const result = await testProviderConnection(); setNotice({ error: !result.default_model_found, text: result.message }); } catch (error) { setNotice({ error: true, text: error.message }); } finally { setChecking(false); } }}>Check saved connection</button>
            <p className="text-[11px] text-zinc-500">Save changes before checking. Reads /models without sending a chat request; some providers do not expose a model catalog.</p>
          </fieldset>
          {checking && <p role="status" className="text-xs text-blue-300">Checking saved endpoint…</p>}
          {notice && <p role={notice.error ? "alert" : "status"} className={`text-xs ${notice.error ? "text-red-400" : "text-emerald-400"}`}>{notice.text}</p>}
          </form>
        </section>}

        {activeSection === "connectors" && <form onSubmit={saveConnector} className={cardClass}>
          <h3 className="text-sm font-semibold">App connectors</h3>
          <label htmlFor="composio-key" className="block text-xs font-medium">Composio API Key</label>
          <input id="composio-key" type="password" autoComplete="new-password" value={composioKey} onChange={(e) => setComposioKey(e.target.value)} placeholder={composioConfigured ? "Stored securely — leave blank to keep" : "Optional connector key"} className={inputClass} disabled={!loaded || saving} />
          <button disabled={!loaded || saving} className={buttonClass}>Save connector key</button>
          {connectorNotice && <p role={connectorNotice.error ? "alert" : "status"} className={`text-xs ${connectorNotice.error ? "text-red-400" : "text-emerald-400"}`}>{connectorNotice.text}</p>}
        </form>}

        {activeSection === "profile" && <div className={cardClass}>
          <h3 className="text-sm font-semibold">Profile</h3>
          <p className="text-xs text-zinc-400">Saved as you type.</p>
          <label htmlFor="profile-name" className="block text-xs font-medium">Your name</label>
          <input id="profile-name" value={userName} onChange={(e) => { setUserName(e.target.value); localStorage.setItem("poka_user_name", e.target.value); onProfileUpdate?.(e.target.value); }} className={inputClass} />
          <label htmlFor="profile-email" className="block text-xs font-medium">Email</label>
          <input id="profile-email" type="email" value={userEmail} onChange={(e) => { setUserEmail(e.target.value); localStorage.setItem("poka_user_email", e.target.value); }} className={inputClass} />
        </div>}
        </div></div>
      </div>
    </section>
  );
}

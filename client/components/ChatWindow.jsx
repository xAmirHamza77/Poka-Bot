'use client';

import React, { useState, useRef, useEffect } from 'react';
import MessageItem from './MessageItem';
import ApprovalCard from './ApprovalCard';
import ModelPicker from './ModelPicker';
import MascotAvatar, { getAvatarType } from './MascotAvatar';
import BrandIcon from './BrandIcon';
import AvatarColorPicker from './AvatarColorPicker';
import { FiPlus, FiMic, FiMicOff, FiMonitor, FiX, FiArrowUp, FiSidebar, FiSettings } from 'react-icons/fi';
import {
  sendMessage,
  subscribeToChatStream,
  uploadImage,
  respondApproval, fetchJobs, fetchChatHistory, cancelJob,
} from '../lib/api';

function formatHeaderDate(msgs) {
  const firstWithDate = msgs?.find((m) => m.created_at);
  if (!firstWithDate || !firstWithDate.created_at) {
    return 'Today';
  }
  const d = new Date(firstWithDate.created_at);
  if (isNaN(d.getTime())) return 'Today';

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return 'Today';
  }

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ChatWindow({ appearance, bot, models, messages, setMessages, onUpdateBotModel, onToggleComputer, defaultModel, providerReady, onOpenSettings, onOpenNewBot, expanded, onToggleSidebar, onUpdateBotColor }) {
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [activeModel, setActiveModel] = useState(bot?.model || defaultModel || 'gpt-5-mini');
  const [selectedImage, setSelectedImage] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [toolEvents, setToolEvents] = useState([]);
  const [sendError, setSendError] = useState('');
  const [activeJob, setActiveJob] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const streamRef = useRef(null);
  const liveRef = useRef(true);
  useEffect(() => { liveRef.current = true; return () => { liveRef.current = false; streamRef.current?.(); }; }, []);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const botTitle = bot?.name || 'Poka Assistant';

  // Initial welcome greeting fallback for the active bot
  const defaultInitialMessages = [
    {
      id: 'msg-intro',
      sender: 'bot',
      text: `Hello! I am **${botTitle}**. Ask me anything, or give me a task to work on!`,
      isError: false,
    },
  ];

  const activeMessages = messages && messages.length > 0 ? messages : defaultInitialMessages;

  useEffect(() => {
    if (bot?.model) {
      setActiveModel(bot.model);
    } else if (defaultModel) {
      setActiveModel(defaultModel);
    }
  }, [bot, defaultModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: appearance?.reducedMotion ? 'instant' : 'smooth' });
  }, [activeMessages, isStreaming, appearance?.reducedMotion]);

  const handleModelChange = (newModel) => {
    setActiveModel(newModel);
    if (onUpdateBotModel && bot?.id) {
      onUpdateBotModel(bot.id, newModel);
    }
  };

  const handleApprovalResponse = async (requestId, action) => {
    await respondApproval(requestId, action);
  };

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Strict IMAGE ONLY validation
    if (!file.type.startsWith('image/')) {
      alert('Only image files (JPEG, PNG, WEBP, GIF, AVIF) are allowed.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setSelectedImage({ file, previewUrl, isUploading: true, uploadedUrl: null, error: null });

    try {
      const res = await uploadImage(file);
      setSelectedImage((prev) => (prev ? { ...prev, isUploading: false, uploadedUrl: res.url } : null));
    } catch (err) {
      console.error('Failed to upload image:', err);
      setSelectedImage((prev) => (prev ? { ...prev, isUploading: false, error: err.message } : null));
    }
  };

  const watchJob = job => {
    setActiveJob(job.id); setIsStreaming(true);
    let streamingMsgId = null;
    streamRef.current?.();
    streamRef.current = subscribeToChatStream(bot.id, activeModel, event => {
      if (!liveRef.current) return;
      setSendError('');
      if (event.type === 'turn.started') {
        streamingMsgId = event.botMsgId;
        setMessages(prev => [...prev.filter(msg => msg.id !== streamingMsgId), {
          id: streamingMsgId, sender: 'bot', text: '', created_at: new Date().toISOString(),
        }]);
      } else if (event.type === 'job.recovered') {
        if (streamingMsgId) setMessages(prev => prev.filter(msg => msg.id !== streamingMsgId));
        streamingMsgId = null;
      } else if (event.type === 'content.delta') {
        setMessages(prev => prev.map(msg => msg.id === streamingMsgId ? { ...msg, text: msg.text + event.delta } : msg));
      } else if (event.type === 'request.opened') {
        setPendingApprovals(prev => [...prev.filter(item => item.requestId !== event.requestId), event]);
      } else if (event.type.startsWith('tool.')) {
        setToolEvents(prev => [...prev.slice(-4), { ...event, id: `${event.type}-${Date.now()}` }]);
        if (['tool.completed', 'tool.failed', 'tool.denied', 'tool.expired'].includes(event.type))
          setPendingApprovals(prev => prev.filter(item => item.requestId !== event.requestId));
      } else if (event.type === 'turn.completed') {
        setIsStreaming(false); setActiveJob(null); setPendingApprovals([]);
        streamRef.current?.();
        if (event.error) setSendError(event.error);
        if (event.ok) fetchChatHistory(bot.id).then(history => { if (liveRef.current) setMessages(history); });
      }
    }, () => { if (liveRef.current) setSendError('Reconnecting… Poka continues working on the server.'); }, job.id);
  };

  useEffect(() => {
    let cancelled = false;
    setMessages([]); setLoadingHistory(true);
    if (!bot?.id) { setLoadingHistory(false); return; }
    Promise.all([fetchChatHistory(bot.id), fetchJobs(bot.id)]).then(([history, jobs]) => {
      if (cancelled) return;
      setMessages(history); setLoadingHistory(false);
      const job = jobs.find(item => ['queued', 'running'].includes(item.status));
      if (job) watchJob(job);
    }).catch(() => { if (!cancelled) { setLoadingHistory(false); setSendError('Could not restore job progress. Reopen this chat to retry.'); } });
    return () => { cancelled = true; streamRef.current?.(); };
    // Restore once per chat mount; changing the model must not replay a live stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot?.id]);

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if ((!inputPrompt.trim() && !selectedImage) || isStreaming || loadingHistory || !bot?.id) return;
    setIsStreaming(true);
    setSendError('');

    const userText = inputPrompt;
    const currentSelected = selectedImage;
    
    setInputPrompt('');
    setSelectedImage(null);

    let finalImageUrl = currentSelected?.uploadedUrl || null;

    // Ensure image upload finishes before dispatching to the inference backend
    if (currentSelected && !finalImageUrl) {
      try {
        const res = await uploadImage(currentSelected.file);
        finalImageUrl = res.url;
      } catch (err) {
        setSendError('Could not upload the image. Try again before sending.');
        setInputPrompt(userText); setSelectedImage(currentSelected); setIsStreaming(false); return;
      }
    }

    const userMsgObj = {
      id: `temp-user-${Date.now()}`,
      sender: 'user',
      text: userText,
      image_url: finalImageUrl || currentSelected?.previewUrl,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsgObj]);

    try {
      if (bot?.id) {
        const result = await sendMessage(bot.id, bot.id, userText, activeModel, finalImageUrl);
        if (!liveRef.current) return;
        if (result.status === 'error') throw new Error(result.detail || 'Message could not be sent.');
        setMessages(prev => prev.map(msg => msg.id === userMsgObj.id ? result.message : msg));
        watchJob(result.job);

      }
    } catch (err) {
      if (!liveRef.current) return;
      setMessages(prev => prev.filter(message => message.id !== userMsgObj.id));
      setSendError(err.message || 'Could not send this message.');
      setInputPrompt(userText);
      setIsStreaming(false);
    }
  };


  const handleVoiceToggle = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice recognition is not supported in this browser environment.');
      return;
    }

    if (isListening) {
      setIsListening(false);
    } else {
      try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.onstart = () => setIsListening(true);
        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          setInputPrompt((prev) => prev + (prev ? ' ' : '') + transcript);
          setIsListening(false);
        };
        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => setIsListening(false);
        recognition.start();
      } catch (err) {
        setIsListening(false);
      }
    }
  };

  return (
    <div className="chat-canvas">
      {/* Top Header Bar */}
      <header className="chat-header">
        <button className="soft-button" onClick={onToggleSidebar} aria-expanded={expanded}><FiSidebar /> Chats</button>
        <div className="chat-identity avatar-identity">
          <button disabled={!bot} className="avatar-edit-button" aria-label="Change Poka avatar color" aria-expanded={avatarPickerOpen} onClick={() => setAvatarPickerOpen(value => !value)}><MascotAvatar type={getAvatarType(bot)} /></button><span>{botTitle}</span>
          {avatarPickerOpen && <><button className="avatar-picker-dismiss" aria-label="Close avatar color picker" onClick={() => setAvatarPickerOpen(false)} /><div className="avatar-picker-popover"><AvatarColorPicker value={bot?.accent_color} disabled={savingAvatar} onChange={async color => { setSavingAvatar(true); try { await onUpdateBotColor(bot.id, color); setAvatarPickerOpen(false); } catch { setSendError('Could not save avatar color. Please retry.'); } finally { setSavingAvatar(false); } }} /></div></>}
        </div>
        <div className="flex items-center gap-2"><ModelPicker models={models} currentModel={activeModel} onSelectModel={handleModelChange} /><button className="icon-button" onClick={onOpenSettings} aria-label="Model settings" title="Model settings"><FiSettings /></button><button className="icon-button" onClick={onToggleComputer} aria-label="Open computer" title="Open computer"><FiMonitor /></button></div>
      </header>

      {/* Main Canvas Scrollable Chat Thread */}
      <div className="chat-thread">
        <div className="chat-messages">
          {/* Centered Recorded Timestamp */}
          <div className="text-center my-4">
            <span className="text-[11px] font-medium text-zinc-500 font-sans tracking-wide">
              {formatHeaderDate(activeMessages)}
            </span>
          </div>

          {pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.requestId}
              approval={approval}
              onRespond={handleApprovalResponse}
            />
          ))}

          {toolEvents.map((event) => (
            <div
              key={event.id}
              className="my-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-300"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-cyan-300">{event.tool || 'workspace'}</span>
                <span className={event.type === 'tool.completed' ? 'text-emerald-400' : 'text-amber-400'}>
                  {event.type.replace('tool.', '')}
                </span>
              </div>
              {event.error && <p className="mt-1 text-rose-300">{event.error}</p>}
              {event.result && (
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-slate-400">
                  {JSON.stringify(event.result, null, 2)}
                </pre>
              )}
            </div>
          ))}

          {/* Message Items List */}
          {!bot ? <div className="chat-welcome"><BrandIcon className="h-24 w-24" /><h1>A space for your next idea.</h1><p>Create an assistant, choose your model, and start a conversation.</p><button className="primary-button" onClick={onOpenNewBot}><FiPlus /> Create an assistant</button><button className="text-sm text-zinc-400 mt-4" onClick={onOpenSettings}>Configure your model</button></div> : activeMessages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}

          {isStreaming && (
            <div className="flex justify-start items-center gap-3 my-3 animate-fade-in">
              <MascotAvatar type={getAvatarType(bot)} size="sm" />
              <div className="bg-[#18181b] border border-[#27272a] px-4 py-3 rounded-2xl flex items-center gap-1.5 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '-0.32s' }} />
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '-0.16s' }} />
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0s' }} />
              </div>
            </div>
          )}


          <div ref={messagesEndRef} />
        </div>
      </div>


      {/* Bottom Floating Pill Composer Input */}
      <div className="composer-area">
        {/* Hidden Image File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

        {/* Selected Image Thumbnail Preview Chip */}
        {selectedImage && (
          <div className="w-full max-w-2xl flex items-center justify-between bg-[#1c1c20] border border-[#2b2b32] px-3 py-1.5 rounded-xl mb-2 text-xs animate-fade-in shadow-md">
            <div className="flex items-center gap-2.5">
              <img
                src={selectedImage.previewUrl}
                alt="Selected Image Preview"
                className="w-9 h-9 rounded-lg object-cover border border-zinc-700 shadow-sm"
              />
              <div className="flex flex-col">
                <span className="text-zinc-200 font-semibold text-[11px] truncate max-w-[180px]">
                  {selectedImage.file.name}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {selectedImage.isUploading
                    ? 'Uploading image...'
                    : selectedImage.error
                    ? `Upload notice: ${selectedImage.error}`
                    : 'Image ready'}
                </span>
              </div>
            </div>

            <button
              suppressHydrationWarning={true}
              type="button"
              onClick={() => setSelectedImage(null)}
              className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-[#2a2a30] transition"
              title="Remove image"
            >
              <FiX className="text-sm" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSendMessage}
          className="message-composer"
        >
          {/* Plus / Image Upload Action Button */}
          <button
            suppressHydrationWarning={true}
            type="button"
            disabled={!bot || !providerReady || isStreaming}
            onClick={() => fileInputRef.current?.click()}
            className="text-zinc-400 hover:text-white transition p-1 text-base flex-shrink-0"
            title="Upload Image (JPEG, PNG, WEBP, GIF, AVIF)"
          >
            <FiPlus />
          </button>

          {/* Textarea Input */}
          <textarea
            suppressHydrationWarning={true}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey && (appearance?.enterToSend !== false || e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            aria-label="Message"
            disabled={!bot || !providerReady}
            placeholder={!bot ? "Create an assistant to get started" : !providerReady ? "Configure a model to start chatting" : `Message ${botTitle}`}
            className="w-full resize-none bg-transparent text-base text-zinc-100 placeholder-zinc-500 focus:outline-none max-h-40"
          />

          {/* Microphone Dictation Button */}
          <button
            suppressHydrationWarning={true}
            type="button"
            disabled={!bot || !providerReady}
            onClick={handleVoiceToggle}
            className={`p-1.5 rounded-full text-base transition flex-shrink-0 ${
              isListening
                ? 'bg-rose-500 text-white animate-pulse'
                : 'text-zinc-400 hover:text-white'
            }`}
            title="Dictate Voice Input"
          >
            {isListening ? <FiMicOff /> : <FiMic />}
          </button>

          {activeJob && <button type="button" className="soft-button" onClick={async () => { try { await cancelJob(activeJob); } catch (error) { setSendError(error.message); } }}>Stop</button>}
          <button type="submit" className="send-button" aria-label="Send message" title="Send message" disabled={!bot || !providerReady || isStreaming || loadingHistory || (!inputPrompt.trim() && !selectedImage) || selectedImage?.isUploading}><FiArrowUp /></button>
        </form>
        {isStreaming && <p className="text-xs text-zinc-400 mt-3">Working in the background · You can leave this chat and return later.</p>}
        {sendError && <p role="alert" className="text-sm text-red-400 mt-3">{sendError}</p>}
        {!providerReady && bot && <button className="text-xs text-blue-400 mt-3" onClick={onOpenSettings}>Set up your custom model →</button>}
      </div>

    </div>
  );
}

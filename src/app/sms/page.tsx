'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, Send, Users, FileText, Activity, Plus, Search, 
  Download, Upload, AlertCircle, CheckCircle2, Trash, Settings, X, Clock, Phone
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { sendSMS, getMessages, getThreads } from '@/app/actions/sms';
import { getContacts, createContact, updateContact, deleteContact, importContactsCSV } from '@/app/actions/contacts';
import { getTemplates, createTemplate, deleteTemplate } from '@/app/actions/templates';
import { getHealthStats, resetHealthStats } from '@/app/actions/health';
import { pusherClient } from '@/utils/pusher-client';

interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  tags: string[];
  notes?: string | null;
  email?: string | null;
  company?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface Message {
  id: string;
  direction: string;
  text: string;
  sender: string;
  recipient: string;
  status: string;
  timestamp: string | Date;
  telnyxMessageId?: string | null;
  carrier?: string | null;
  errorReason?: string | null;
  contactId?: string | null;
}

interface Thread {
  contact: Contact;
  lastMessage: Message | null;
}

interface HealthStats {
  id: string;
  totalSent: number;
  delivered: number;
  failed: number;
  optOut: number;
  carrierBlocked: number;
  updatedAt: string | Date;
}

interface CarrierLog {
  id: string;
  messageId?: string | null;
  phoneNumber: string;
  carrier?: string | null;
  reason: string;
  code?: string | null;
  timestamp: string | Date;
  messageText?: string;
}

interface Template {
  id: string;
  name: string;
  content: string;
  createdAt: string | Date;
}

const DALLAS_NUMBER = process.env.NEXT_PUBLIC_TELNYX_NUMBER || '+12147746991';
const TOLL_FREE_NUMBER = '+18667774939';

export default function SMSPage() {
  // Active Phone Line (Dallas vs Toll-Free)
  const [activeLine, setActiveLine] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('telnyx_active_number') || DALLAS_NUMBER;
    }
    return DALLAS_NUMBER;
  });
  const activeLineRef = useRef<string>(activeLine);

  useEffect(() => {
    activeLineRef.current = activeLine;
  }, [activeLine]);

  // SMS Inbox State
  const [smsThreads, setSmsThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThreadMessages, setActiveThreadMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newSmsText, setNewSmsText] = useState('');
  const [sendingSms, setSendingSms] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // CRM Tab State
  const [crmTab, setCrmTab] = useState<'contacts' | 'templates' | 'health'>('contacts');
  const [contactsList, setContactsList] = useState<Contact[]>([]);
  const [templatesList, setTemplatesList] = useState<Template[]>([]);
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  const [carrierLogs, setCarrierLogs] = useState<CarrierLog[]>([]);
  const [loadingCrm, setLoadingCrm] = useState(false);

  // Search & Filters
  const [threadsSearchQuery, setThreadsSearchQuery] = useState('');
  const [contactsSearchQuery, setContactsSearchQuery] = useState('');

  // Modals
  const [showDirectMessageModal, setShowDirectMessageModal] = useState(false);
  const [dmPhoneInput, setDmPhoneInput] = useState('');
  const [dmNameInput, setDmNameInput] = useState('');
  const [dmTextInput, setDmTextInput] = useState('');
  const [dmSending, setDmSending] = useState(false);

  const [showContactModal, setShowContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [contactNameInput, setContactNameInput] = useState('');
  const [contactPhoneInput, setContactPhoneInput] = useState('');
  const [contactTagsInput, setContactTagsInput] = useState('');
  const [contactNotesInput, setContactNotesInput] = useState('');
  const [contactEmailInput, setContactEmailInput] = useState('');
  const [contactCompanyInput, setContactCompanyInput] = useState('');

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [templateContentInput, setTemplateContentInput] = useState('');

  // Refs
  const activeThreadIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
    if (activeThreadId) {
      scrollToBottom();
    }
  }, [activeThreadId, activeThreadMessages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const switchLine = async (lineNum: string) => {
    setActiveLine(lineNum);
    activeLineRef.current = lineNum;
    if (typeof window !== 'undefined') {
      localStorage.setItem('telnyx_active_number', lineNum);
    }
    setLoadingThreads(true);
    await loadThreads(lineNum);
    setLoadingThreads(false);
    if (activeThreadIdRef.current) {
      const thread = smsThreads.find(t => t.contact.id === activeThreadIdRef.current);
      if (thread) {
        setLoadingMessages(true);
        const res = await getMessages(thread.contact.id, lineNum);
        if (res.success && res.messages) {
          setActiveThreadMessages(res.messages);
        }
        setLoadingMessages(false);
      }
    }
  };

  // Initial Data Fetching
  useEffect(() => {
    const initData = async () => {
      setLoadingThreads(true);
      await loadThreads(activeLineRef.current);
      setLoadingThreads(false);
      
      await loadContacts();
      await loadTemplates();
      await loadHealthStats();
    };
    initData();
  }, []);

  // Pusher Synchronization
  useEffect(() => {
    if (!pusherClient) return;
    const client = pusherClient;
    const channel = client.subscribe('sms-channel');

    channel.bind('new-message', async (data: any) => {
      const current = activeLineRef.current || DALLAS_NUMBER;
      const cleanLine = current.replace(/\D/g, '');
      const recDigits = (data.recipient || '').replace(/\D/g, '');
      const sendDigits = (data.sender || '').replace(/\D/g, '');
      const isForActiveLine = recDigits.includes(cleanLine.slice(-10)) || sendDigits.includes(cleanLine.slice(-10));

      if (isForActiveLine) {
        await loadThreads(current);
        if (activeThreadIdRef.current && data.contactId === activeThreadIdRef.current) {
          setActiveThreadMessages(prev => {
            if (prev.some(m => m.id === data.id || (m.telnyxMessageId && m.telnyxMessageId === data.telnyxMessageId))) {
              return prev;
            }
            return [...prev, data];
          });
        }
      }
    });

    channel.bind('message-status-update', async (data: any) => {
      if (activeThreadIdRef.current && data.contactId === activeThreadIdRef.current) {
        setActiveThreadMessages(prev => prev.map(m => m.id === data.id ? { ...m, ...data } : m));
      }
      await loadThreads(activeLineRef.current);
      await loadHealthStats();
    });

    channel.bind('new-contact', (data: any) => {
      setContactsList(prev => {
        if (prev.some(c => c.id === data.id)) return prev;
        return [...prev, data].sort((a, b) => a.name.localeCompare(b.name));
      });
      loadThreads(activeLineRef.current);
    });

    channel.bind('update-contact', (data: any) => {
      setContactsList(prev => prev.map(c => c.id === data.id ? data : c).sort((a, b) => a.name.localeCompare(b.name)));
      loadThreads(activeLineRef.current);
    });

    channel.bind('delete-contact', (data: any) => {
      setContactsList(prev => prev.filter(c => c.id !== data.id));
      loadThreads(activeLineRef.current);
      if (activeThreadIdRef.current === data.id) {
        setActiveThreadId(null);
      }
    });

    return () => {
      client.unsubscribe('sms-channel');
    };
  }, []);

  // API wrappers
  const loadThreads = async (lineNum?: string) => {
    const line = lineNum || activeLineRef.current || DALLAS_NUMBER;
    const res = await getThreads(line);
    if (res.success && res.threads) {
      setSmsThreads(res.threads);
    }
  };

  const loadContacts = async () => {
    setLoadingCrm(true);
    const res = await getContacts();
    if (res.success && res.contacts) {
      setContactsList(res.contacts);
    }
    setLoadingCrm(false);
  };

  const loadTemplates = async () => {
    setLoadingCrm(true);
    const res = await getTemplates();
    if (res.success && res.templates) {
      setTemplatesList(res.templates);
    }
    setLoadingCrm(false);
  };

  const loadHealthStats = async () => {
    setLoadingCrm(true);
    const res = await getHealthStats();
    if (res.success) {
      setHealthStats(res.stats || null);
      setCarrierLogs(res.carrierLogs || []);
    }
    setLoadingCrm(false);
  };

  const openThread = async (contact: Contact) => {
    setActiveThreadId(contact.id);
    setLoadingMessages(true);
    const line = activeLineRef.current || DALLAS_NUMBER;
    const res = await getMessages(contact.id, line);
    if (res.success && res.messages) {
      setActiveThreadMessages(res.messages);
    }
    setLoadingMessages(false);
  };

  const handleSendSms = async () => {
    if (!activeThreadId || !newSmsText.trim()) return;

    const activeThread = smsThreads.find(t => t.contact.id === activeThreadId);
    if (!activeThread) return;

    setSendingSms(true);
    const sendingFrom = activeLineRef.current || DALLAS_NUMBER;
    const res = await sendSMS(activeThread.contact.phoneNumber, newSmsText, activeThread.contact.id, sendingFrom);
    setSendingSms(false);

    if (res.success) {
      setNewSmsText('');
      const msgRes = await getMessages(activeThreadId, sendingFrom);
      if (msgRes.success && msgRes.messages) {
        setActiveThreadMessages(msgRes.messages);
      }
      loadThreads(sendingFrom);
    } else {
      setErrorMessage(res.error || 'Failed to send SMS.');
    }
  };

  const handleDirectMessage = async () => {
    if (!dmPhoneInput.trim() || !dmTextInput.trim()) {
      setErrorMessage('Phone number and text message are required.');
      return;
    }

    setDmSending(true);
    // 1. Format phone input
    const cleanNum = dmPhoneInput.replace(/[^0-9+]/g, '');
    let finalPhone = cleanNum;
    if (!finalPhone.startsWith('+')) {
      if (finalPhone.length === 10) finalPhone = '+1' + finalPhone;
      else finalPhone = '+' + finalPhone;
    }

    // 2. Ensure Contact exists
    let contact = contactsList.find(c => c.phoneNumber === finalPhone);
    if (!contact) {
      const cRes = await createContact(dmNameInput.trim() || finalPhone, finalPhone, ['Lead']);
      if (cRes.success && cRes.contact) {
        contact = cRes.contact as Contact;
      } else {
        setErrorMessage(cRes.error || 'Failed to create contact for message.');
        setDmSending(false);
        return;
      }
    }

    // 3. Send SMS from active line
    const sendingFrom = activeLineRef.current || DALLAS_NUMBER;
    const res = await sendSMS(finalPhone, dmTextInput, contact.id, sendingFrom);
    setDmSending(false);

    if (res.success) {
      setShowDirectMessageModal(false);
      setDmPhoneInput('');
      setDmNameInput('');
      setDmTextInput('');
      await loadThreads(sendingFrom);
      openThread(contact);
    } else {
      setErrorMessage(res.error || 'Failed to dispatch direct message.');
    }
  };

  const handleSaveContact = async () => {
    if (!contactPhoneInput.trim()) {
      setErrorMessage('Phone number is required.');
      return;
    }

    const tagsArray = contactTagsInput.split(',').map(t => t.trim()).filter(Boolean);

    let res;
    if (editingContact) {
      res = await updateContact(editingContact.id, {
        name: contactNameInput,
        phoneNumber: contactPhoneInput,
        tags: tagsArray,
        notes: contactNotesInput,
        email: contactEmailInput,
        company: contactCompanyInput,
      });
    } else {
      res = await createContact(
        contactNameInput,
        contactPhoneInput,
        tagsArray,
        contactNotesInput,
        contactEmailInput,
        contactCompanyInput
      );
    }

    if (res.success) {
      setShowContactModal(false);
      setEditingContact(null);
      await loadContacts();
    } else {
      setErrorMessage(res.error || 'Failed to save contact.');
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (confirm('Are you sure you want to delete this contact?')) {
      const res = await deleteContact(id);
      if (res.success) await loadContacts();
      else setErrorMessage(res.error || 'Failed to delete contact.');
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateNameInput.trim() || !templateContentInput.trim()) {
      setErrorMessage('Template name and content are required.');
      return;
    }

    const res = await createTemplate(templateNameInput, templateContentInput);
    if (res.success) {
      setShowTemplateModal(false);
      setTemplateNameInput('');
      setTemplateContentInput('');
      await loadTemplates();
    } else {
      setErrorMessage(res.error || 'Failed to save template.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      const res = await deleteTemplate(id);
      if (res.success) await loadTemplates();
      else setErrorMessage(res.error || 'Failed to delete template.');
    }
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (text) {
        setLoadingCrm(true);
        const res = await importContactsCSV(text);
        setLoadingCrm(false);
        if (res.success) {
          alert(`Successfully imported ${res.importedCount} contacts. Failed: ${res.failedCount}.`);
          await loadContacts();
        } else {
          setErrorMessage(res.error || 'Failed to import CSV.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleCsvExport = () => {
    if (contactsList.length === 0) {
      alert('No contacts available to export.');
      return;
    }
    const headers = ['Name', 'Phone Number', 'Email', 'Company', 'Tags', 'Notes', 'Created At'];
    const rows = contactsList.map(c => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.phoneNumber}"`,
      `"${(c.email || '').replace(/"/g, '""')}"`,
      `"${(c.company || '').replace(/"/g, '""')}"`,
      `"${c.tags.join(';')}"`,
      `"${(c.notes || '').replace(/"/g, '""')}"`,
      new Date(c.createdAt).toLocaleDateString(),
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `contacts_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResetHealthStats = async () => {
    if (confirm('Are you sure you want to reset all delivery health statistics?')) {
      const res = await resetHealthStats();
      if (res.success) await loadHealthStats();
      else setErrorMessage(res.error || 'Failed to reset health stats.');
    }
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center gap-6 p-2 sm:p-4 relative selection:bg-zinc-800">
      {/* Background light glow */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(24,24,27,0.4)_0%,transparent_100%)] pointer-events-none" />

      {/* Global Navbar */}
      <Navbar />

      {/* Main Outreach workspace layout */}
      <main className="z-10 w-full max-w-6xl flex-grow grid grid-cols-1 lg:grid-cols-[18rem_1fr_20rem] gap-6 items-stretch justify-center pb-6 min-h-[580px]">
        
        {/* ========================================== */}
        {/* COLUMN 1: SMS CONVERSATIONS THREADS */}
        {/* ========================================== */}
        <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 flex flex-col h-[580px]">
          <div className="flex items-center justify-between mb-3.5 pb-2 border-b border-zinc-900 select-none">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-zinc-500" />
              <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400">SMS Inbox</h2>
            </div>
            
            <button
              onClick={() => {
                setDmPhoneInput('');
                setDmNameInput('');
                setDmTextInput('');
                setShowDirectMessageModal(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 text-black rounded-lg text-[9px] font-bold uppercase tracking-wider hover:bg-emerald-400 transition-all active:scale-95 shadow-sm"
              title="Direct Message"
            >
              <Plus size={10} /> Direct Message
            </button>
          </div>

          {/* Dedicated Per-Number Inboxes Tab Bar */}
          <div className="flex items-center gap-1.5 mb-3 p-1 bg-zinc-900/90 rounded-xl border border-zinc-800 shrink-0 select-none">
            {[
              { num: DALLAS_NUMBER, label: 'Dallas', formatted: '+1 (214) 774-6991' },
              { num: TOLL_FREE_NUMBER, label: 'Toll-Free', formatted: '+1 (866) 777-4939' },
            ].map((line) => {
              const isSelected = activeLine === line.num;
              return (
                <button
                  key={line.num}
                  type="button"
                  onClick={() => switchLine(line.num)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/15'
                      : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                  }`}
                >
                  <span>{line.label} Inbox</span>
                  <span className="text-[10px] font-mono opacity-80">({line.formatted})</span>
                </button>
              );
            })}
          </div>

          {/* Search bar */}
          <div className="relative mb-3 select-none">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-655" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={threadsSearchQuery}
              onChange={(e) => setThreadsSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-900 rounded-xl pl-8 pr-7 py-1.5 text-xs text-zinc-350 focus:outline-none focus:border-zinc-800 placeholder-zinc-650"
            />
            {threadsSearchQuery && (
              <button
                onClick={() => setThreadsSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
              >
                <X size={10} />
              </button>
            )}
          </div>

          {/* Threads List */}
          <div className="flex-grow overflow-y-auto pr-1 space-y-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            {loadingThreads ? (
              <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
                <div className="w-5 h-5 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin mb-2" />
                <span className="text-[10px] uppercase font-bold tracking-wider animate-pulse">Loading inbox...</span>
              </div>
            ) : (() => {
              const filtered = smsThreads.filter(t => 
                t.contact.name.toLowerCase().includes(threadsSearchQuery.toLowerCase()) ||
                t.contact.phoneNumber.includes(threadsSearchQuery)
              );

              if (filtered.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-24 text-zinc-700 select-none">
                    <MessageSquare size={28} className="opacity-10 mb-3" />
                    <p className="text-xs">No active chats found</p>
                  </div>
                );
              }

              return filtered.map((thread) => {
                const isSelected = activeThreadId === thread.contact.id;
                const initials = thread.contact.name
                  .split(' ')
                  .map(n => n[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();

                const optOut = thread.contact.tags.includes('Opted Out');

                return (
                  <button
                    key={thread.contact.id}
                    onClick={() => openThread(thread.contact)}
                    className={`w-full text-left p-3 rounded-2xl border transition-all duration-200 flex items-center gap-3 relative group ${
                      isSelected
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-zinc-900/10 border-zinc-900/50 hover:bg-zinc-900/40 hover:border-zinc-800/40'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 ${
                      isSelected
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-450'
                        : 'bg-zinc-950 border-zinc-900 text-zinc-455'
                    }`}>
                      {initials || '#'}
                    </div>

                    <div className="flex-grow min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-emerald-450' : 'text-zinc-300'}`}>
                          {thread.contact.name}
                        </h4>
                        {thread.lastMessage && (
                          <span className="text-[8px] text-zinc-550 shrink-0 font-mono ml-1">
                            {formatTime(new Date(thread.lastMessage.timestamp).getTime())}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {thread.lastMessage && (
                          <>
                            {thread.lastMessage.direction === 'outbound' && (
                              <span className={`shrink-0 text-[10px] ${
                                thread.lastMessage.status === 'delivered' ? 'text-emerald-500 font-bold' :
                                thread.lastMessage.status === 'failed' ? 'text-red-500 font-bold' : 'text-zinc-500'
                              }`}>
                                {thread.lastMessage.status === 'delivered' ? '✓✓' :
                                 thread.lastMessage.status === 'failed' ? '!' : '✓'}
                              </span>
                            )}
                            <p className="text-[10px] text-zinc-500 truncate flex-grow">
                              {thread.lastMessage.text}
                            </p>
                          </>
                        )}
                        {!thread.lastMessage && (
                          <p className="text-[10px] text-zinc-650 italic flex-grow">No messages yet</p>
                        )}
                        {optOut && (
                          <span className="shrink-0 text-[8px] bg-red-950/30 border border-red-900/40 text-red-400 px-1 rounded font-bold uppercase select-none">
                            STOP
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        {/* ========================================== */}
        {/* COLUMN 2: ACTIVE CONVERSATION CHAT VIEW */}
        {/* ========================================== */}
        <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 flex flex-col h-[580px] relative">
          
          {activeThreadId === null ? (
            /* PLACEHOLDER - NO CHAT SELECTED */
            <div className="flex-grow flex flex-col items-center justify-center text-zinc-700 select-none">
              <div className="relative flex items-center justify-center mb-6">
                <div className="absolute w-14 h-14 border border-dashed border-zinc-900 rounded-full animate-pulse" />
                <MessageSquare className="w-6 h-6 text-zinc-600" />
              </div>
              <h3 className="text-sm font-bold tracking-wider uppercase text-zinc-500">Outreach workspace</h3>
              <p className="text-xs text-zinc-600 mt-1.5 max-w-[20rem] text-center">
                Select a thread from the inbox or click "Direct Message" to start outreach campaigns.
              </p>
            </div>
          ) : (() => {
            const activeThread = smsThreads.find(t => t.contact.id === activeThreadId);
            if (!activeThread) return null;

            const initials = activeThread.contact.name
              .split(' ')
              .map(n => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();

            const isOptedOut = activeThread.contact.tags.includes('Opted Out');

            return (
              <div className="flex-grow flex flex-col h-full overflow-hidden select-text">
                {/* Active Chat Header */}
                <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                      {initials || '#'}
                    </div>
                    <div className="text-left">
                      <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wide">
                        {activeThread.contact.name}
                        {activeThread.contact.company && (
                          <span className="text-[9px] text-zinc-550 normal-case ml-1.5 font-normal">🏢 {activeThread.contact.company}</span>
                        )}
                      </h3>
                      <p className="text-[10px] text-zinc-550 font-mono mt-0.5">
                        {activeThread.contact.phoneNumber}
                        {activeThread.contact.email && (
                          <span className="text-[9px] text-zinc-500 font-sans ml-2">✉️ {activeThread.contact.email}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 select-none">
                    {activeThread.contact.notes && (
                      <span className="hidden md:inline-block text-[9px] bg-zinc-900 border border-zinc-850 px-2 py-1 rounded text-zinc-400 truncate max-w-[12rem]" title={activeThread.contact.notes}>
                        Note: {activeThread.contact.notes}
                      </span>
                    )}
                    <button
                      onClick={() => setActiveThreadId(null)}
                      className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-150 transition-colors"
                      title="Close Chat"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                {/* Active Sending Line Bar */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border border-zinc-850 rounded-xl my-2 text-xs select-none shrink-0">
                  <span className="text-zinc-400 text-[11px] font-medium">Sending SMS as:</span>
                  <div className="flex items-center gap-1.5">
                    {[
                      { num: DALLAS_NUMBER, label: 'Dallas', formatted: '+1 (214) 774-6991' },
                      { num: TOLL_FREE_NUMBER, label: 'Toll-Free', formatted: '+1 (866) 777-4939' },
                    ].map((l) => (
                      <button
                        key={l.num}
                        type="button"
                        onClick={() => switchLine(l.num)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                          activeLine === l.num
                            ? 'bg-emerald-500 text-black font-extrabold shadow-sm'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                        }`}
                      >
                        <span>{l.label}</span>
                        <span className="text-[10px] font-mono opacity-80 font-normal">({l.formatted})</span>
                        {activeLine === l.num && <span className="w-1.5 h-1.5 rounded-full bg-black ml-0.5" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error log alert inside chat */}
                {errorMessage && (
                  <div className="m-2 p-2 rounded-xl bg-red-950/20 border border-red-900/35 text-red-400 text-[10px] text-center flex items-center justify-between gap-1 select-none">
                    <span>{errorMessage}</span>
                    <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-350">
                      <X size={10} />
                    </button>
                  </div>
                )}

                {/* Messages Viewport */}
                <div className="flex-grow overflow-y-auto py-4 pr-1.5 space-y-4 scrollbar-thin scrollbar-thumb-zinc-805 scrollbar-track-transparent">
                  {loadingMessages ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                      <div className="w-5 h-5 border-2 border-zinc-850 border-t-emerald-500 rounded-full animate-spin mb-2" />
                      <p className="text-[10px] uppercase font-bold tracking-wider animate-pulse">Loading message history...</p>
                    </div>
                  ) : activeThreadMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-700 select-none py-12">
                      <MessageSquare size={36} className="opacity-10 mb-2" />
                      <p className="text-xs">No outreach history found. Send the first SMS!</p>
                    </div>
                  ) : (
                    activeThreadMessages.map((msg) => {
                      const isInbound = msg.direction === 'inbound';
                      const msgTime = formatTime(new Date(msg.timestamp).getTime());
                      const msgDate = new Date(msg.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'} w-full`}
                        >
                          <div
                            className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-xs text-left ${
                              isInbound
                                ? 'bg-zinc-900 text-zinc-200 rounded-bl-none border border-zinc-900/50'
                                : 'bg-emerald-950/20 border border-emerald-900/40 text-emerald-300 rounded-br-none'
                            }`}
                          >
                            <p className="leading-relaxed break-words">{msg.text}</p>
                            {msg.errorReason && (
                              <div className="mt-1.5 p-1.5 rounded-lg bg-red-950/40 border border-red-900/40 text-[9px] text-red-400 flex items-start gap-1">
                                <AlertCircle size={10} className="shrink-0 mt-0.5" />
                                <span>
                                  <strong>Carrier Block:</strong> {msg.errorReason} {msg.carrier ? `(${msg.carrier})` : ''}
                                </span>
                              </div>
                            )}
                          </div>
                          <span className="text-[8px] text-zinc-600 mt-1 select-none font-mono">
                            {msgDate} • {msgTime}
                            {!isInbound && (
                              <span className={`ml-1 font-bold ${
                                msg.status === 'delivered' ? 'text-emerald-500' :
                                msg.status === 'failed' ? 'text-red-500' : 'text-zinc-550'
                              }`}>
                                • {msg.status.toUpperCase()}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Footer Input Area */}
                <div className="pt-3 border-t border-zinc-900 select-none">
                  {isOptedOut ? (
                    <div className="p-2.5 rounded-xl bg-red-950/20 border border-red-900/40 text-[10px] text-red-400 text-center font-bold">
                      Lead has opted out (STOP). Outbound SMS block active.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex justify-between items-center text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                        <span>
                          Segments: {Math.ceil(newSmsText.length / 160)} ({newSmsText.length} chars)
                        </span>
                        
                        <select
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              const parsed = val.replace(/{Name}/g, activeThread.contact.name);
                              setNewSmsText(prev => prev + parsed);
                              e.target.value = '';
                            }
                          }}
                          className="bg-zinc-950 border border-zinc-900 text-zinc-550 hover:text-zinc-350 rounded-lg px-2 py-0.5 text-[9px] focus:outline-none transition-all cursor-pointer"
                        >
                          <option value="">Quick template...</option>
                          {templatesList.map((temp) => (
                            <option key={temp.id} value={temp.content}>
                              {temp.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type message... (footer appended automatically)"
                          value={newSmsText}
                          onChange={(e) => setNewSmsText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !sendingSms) handleSendSms();
                          }}
                          disabled={sendingSms}
                          className="flex-grow bg-zinc-950 border border-zinc-900 rounded-xl px-3.5 py-2.5 text-xs text-zinc-350 focus:outline-none focus:border-zinc-800 placeholder-zinc-650"
                        />
                        <button
                          onClick={handleSendSms}
                          disabled={sendingSms || !newSmsText.trim()}
                          className="px-4 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all active:scale-95 disabled:bg-zinc-900 disabled:text-zinc-600 disabled:cursor-not-allowed flex items-center justify-center shrink-0"
                        >
                          {sendingSms ? (
                            <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Send size={12} fill="currentColor" />
                          )}
                        </button>
                      </div>
                      <div className="text-[9px] text-zinc-500 text-center font-medium">
                        Press Enter to send • Sending from {activeLine === TOLL_FREE_NUMBER ? 'Toll-Free (+1 866-777-4939)' : 'Dallas (+1 214-774-6991)'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ========================================== */}
        {/* COLUMN 3: CRM PANEL OVERLAYS */}
        {/* ========================================== */}
        <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 flex flex-col h-[580px]">
          
          {/* Tabs Selector */}
          <div className="flex bg-zinc-950 p-1 border border-zinc-900 rounded-xl mb-4 select-none">
            {[
              { id: 'contacts', label: 'Leads', icon: Users },
              { id: 'templates', label: 'Templates', icon: FileText },
              { id: 'health', label: 'Health', icon: Activity },
            ].map((tab) => {
              const Icon = tab.icon;
              const isSelected = crmTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCrmTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 ${
                    isSelected
                      ? 'bg-zinc-900 text-emerald-450 shadow-sm border border-zinc-850/50'
                      : 'text-zinc-550 hover:text-zinc-350'
                  }`}
                >
                  <Icon size={11} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* CRM TAB CONTENT AREA */}
          <div className="flex-grow overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            
            {/* TAB 1: LEADS DIRECTORY */}
            {crmTab === 'contacts' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1 select-none">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-550">Leads Directory</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditingContact(null);
                        setContactNameInput('');
                        setContactPhoneInput('');
                        setContactTagsInput('');
                        setContactNotesInput('');
                        setContactEmailInput('');
                        setContactCompanyInput('');
                        setShowContactModal(true);
                      }}
                      className="px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-[9px] font-bold rounded-lg text-emerald-400 uppercase tracking-wider"
                    >
                      Add Lead
                    </button>
                    <button
                      onClick={handleCsvExport}
                      className="p-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 rounded-lg"
                      title="Export CSV"
                    >
                      <Download size={11} />
                    </button>
                    <label className="p-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 text-zinc-450 rounded-lg cursor-pointer">
                      <Upload size={11} />
                      <input type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
                    </label>
                  </div>
                </div>

                <div className="relative mb-2 select-none">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-650" />
                  <input
                    type="text"
                    placeholder="Search directory..."
                    value={contactsSearchQuery}
                    onChange={(e) => setContactsSearchQuery(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-lg pl-7 pr-3 py-1 text-[11px] text-zinc-350 focus:outline-none placeholder-zinc-700"
                  />
                </div>

                {loadingCrm && contactsList.length === 0 ? (
                  <div className="py-12 text-center text-zinc-600">
                    <div className="w-4 h-4 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
                    <span className="text-[9px] uppercase font-bold tracking-wider">Syncing directory...</span>
                  </div>
                ) : (() => {
                  const filtered = contactsList.filter(c => 
                    c.name.toLowerCase().includes(contactsSearchQuery.toLowerCase()) ||
                    c.phoneNumber.includes(contactsSearchQuery) ||
                    c.tags.some(t => t.toLowerCase().includes(contactsSearchQuery.toLowerCase()))
                  );

                  if (filtered.length === 0) {
                    return (
                      <div className="py-12 text-center text-zinc-700 select-none text-[11px]">
                        No leads registered in database.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {filtered.map((contact) => {
                        const optOut = contact.tags.includes('Opted Out');
                        return (
                          <div
                            key={contact.id}
                            className="p-3 bg-zinc-900/10 border border-zinc-900/60 rounded-xl hover:border-zinc-850/60 transition-all text-left space-y-2 group"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-xs font-semibold text-zinc-300 group-hover:text-zinc-150 truncate max-w-[10rem]">
                                  {contact.name}
                                </h4>
                                <p className="text-[10px] text-zinc-550 font-mono mt-0.5">{contact.phoneNumber}</p>
                                {(contact.company || contact.email) && (
                                  <div className="text-[9px] text-zinc-500 mt-1 space-y-0.5 font-sans">
                                    {contact.company && <div>🏢 {contact.company}</div>}
                                    {contact.email && <div>✉️ {contact.email}</div>}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-1 select-none opacity-60 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => openThread(contact)}
                                  className="p-1 rounded bg-zinc-950 border border-zinc-900 hover:border-emerald-500/30 text-zinc-400 hover:text-emerald-450"
                                  title="Text Lead"
                                >
                                  <MessageSquare size={10} />
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingContact(contact);
                                    setContactNameInput(contact.name);
                                    setContactPhoneInput(contact.phoneNumber);
                                    setContactTagsInput(contact.tags.join(', '));
                                    setContactNotesInput(contact.notes || '');
                                    setContactEmailInput(contact.email || '');
                                    setContactCompanyInput(contact.company || '');
                                    setShowContactModal(true);
                                  }}
                                  className="p-1 rounded bg-zinc-950 border border-zinc-900 hover:bg-zinc-900 text-zinc-450"
                                  title="Edit"
                                >
                                  <Settings size={10} />
                                </button>
                                <button
                                  onClick={() => handleDeleteContact(contact.id)}
                                  className="p-1 rounded bg-zinc-950 border border-zinc-900 hover:bg-red-950 hover:text-red-400 text-zinc-600"
                                  title="Delete"
                                >
                                  <Trash size={10} />
                                </button>
                              </div>
                            </div>

                            {/* Tags list */}
                            <div className="flex flex-wrap gap-1 select-none">
                              {contact.tags.map(t => (
                                <span key={t} className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${
                                  t === 'Opted Out' 
                                    ? 'bg-red-950/20 border-red-900/30 text-red-400' 
                                    : 'bg-emerald-950/20 border-emerald-900/20 text-emerald-450'
                                }`}>
                                  {t}
                                </span>
                              ))}
                              {contact.notes && (
                                <span className="text-[9px] text-zinc-500 italic truncate max-w-xs block pl-1">
                                  {contact.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB 2: TEMPLATES SELECTOR */}
            {crmTab === 'templates' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1 select-none">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-550">Outreach templates</span>
                  <button
                    onClick={() => {
                      setTemplateNameInput('');
                      setTemplateContentInput('');
                      setShowTemplateModal(true);
                    }}
                    className="px-2 py-1 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-[9px] font-bold rounded-lg text-emerald-400 uppercase tracking-wider"
                  >
                    Add Template
                  </button>
                </div>

                {loadingCrm && templatesList.length === 0 ? (
                  <div className="py-12 text-center text-zinc-650">
                    <div className="w-4 h-4 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
                    <span className="text-[9px] uppercase font-bold tracking-wider animate-pulse">Syncing templates...</span>
                  </div>
                ) : templatesList.length === 0 ? (
                  <div className="py-12 text-center text-zinc-700 select-none text-[11px]">
                    No campaign templates configured.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {templatesList.map((temp) => (
                      <div
                        key={temp.id}
                        className="p-3 bg-zinc-900/10 border border-zinc-900/60 rounded-xl text-left space-y-1.5 relative group"
                      >
                        <div className="flex items-center justify-between select-none">
                          <h4 className="text-[11px] font-bold text-zinc-300 uppercase tracking-wide truncate pr-3">{temp.name}</h4>
                          <button
                            onClick={() => handleDeleteTemplate(temp.id)}
                            className="text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete Template"
                          >
                            <Trash size={10} />
                          </button>
                        </div>
                        <p className="text-[10px] text-zinc-450 leading-relaxed font-normal bg-zinc-950/20 p-2 rounded-lg border border-zinc-950">
                          {temp.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: SYSTEM HEALTH DIAGNOSTICS */}
            {crmTab === 'health' && (
              <div className="space-y-4 text-left">
                {/* Stats Widget */}
                {healthStats && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between select-none border-b border-zinc-900 pb-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-550">Outbound Health</span>
                      <button
                        onClick={handleResetHealthStats}
                        className="text-[8px] bg-zinc-900 hover:bg-red-950 hover:text-red-405 border border-zinc-800 px-2 py-0.5 rounded uppercase font-bold"
                      >
                        Reset Stats
                      </button>
                    </div>

                    {/* Deliverability score circular progress */}
                    <div className="flex items-center gap-4 bg-zinc-900/10 border border-zinc-900 p-3.5 rounded-2xl">
                      <div className="relative w-14 h-14 flex items-center justify-center bg-zinc-950 border border-zinc-900 rounded-full shrink-0">
                        {(() => {
                          const total = healthStats.totalSent;
                          const rate = total > 0 ? Math.round((healthStats.delivered / total) * 100) : 100;
                          const radius = 22;
                          const circumference = 2 * Math.PI * radius;
                          const strokeDashoffset = circumference - (rate / 100) * circumference;
                          return (
                            <>
                              <svg className="absolute w-full h-full -rotate-90">
                                <circle cx="28" cy="28" r={radius} stroke="#18181b" strokeWidth="2.5" fill="transparent" />
                                <circle
                                  cx="28"
                                  cy="28"
                                  r={radius}
                                  strokeWidth="2.5"
                                  fill="transparent"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={strokeDashoffset}
                                  className="stroke-emerald-500 transition-all duration-300"
                                />
                              </svg>
                              <span className="text-[10px] font-bold font-mono text-emerald-450 z-10">{rate}%</span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="text-left">
                        <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-widest block">Deliverability Score</span>
                        <h4 className="text-xs font-bold text-zinc-250 mt-0.5">Reputation Health</h4>
                        <p className="text-[9px] text-zinc-500 font-sans mt-0.5 leading-tight">Outbox score is computed dynamically based on delivery notifications.</p>
                      </div>
                    </div>

                    {/* Log Auditor grid */}
                    <div className="grid grid-cols-2 gap-2 text-left select-none">
                      <div className="p-2.5 bg-zinc-900/10 border border-zinc-900 rounded-xl">
                        <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-wider block">Sent Logs</span>
                        <span className="text-sm font-bold font-mono text-zinc-350">{healthStats.totalSent}</span>
                      </div>
                      
                      {(() => {
                        const total = healthStats.totalSent;
                        const rate = total > 0 ? Math.round((healthStats.delivered / total) * 100) : 100;
                        return (
                          <div className="p-2.5 bg-zinc-900/10 border border-zinc-900 rounded-xl">
                            <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-wider block">Delivered</span>
                            <span className="text-sm font-bold font-mono text-emerald-450">{healthStats.delivered}</span>
                          </div>
                        );
                      })()}

                      {(() => {
                        const total = healthStats.totalSent;
                        const rate = total > 0 ? Math.round((healthStats.optOut / total) * 100) : 0;
                        return (
                          <div className="p-2.5 bg-zinc-900/10 border border-zinc-900 rounded-xl">
                            <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-wider block">Opt-Outs</span>
                            <span className="text-sm font-bold font-mono text-amber-500">{healthStats.optOut}</span>
                          </div>
                        );
                      })()}

                      <div className="p-2.5 bg-zinc-900/10 border border-zinc-900 rounded-xl">
                        <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-wider block">Blocked</span>
                        <span className="text-sm font-bold font-mono text-red-450">{healthStats.carrierBlocked}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Compliance Checklist */}
                <div className="space-y-2.5 p-3.5 bg-zinc-900/10 border border-zinc-900 rounded-2xl">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-555 block select-none border-b border-zinc-900 pb-1">Compliance Validation</span>
                  <div className="space-y-1.5 text-[10px] font-bold tracking-wide">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">TCR Toll-Free Registration</span>
                      <span className="text-emerald-400 flex items-center gap-1 font-mono uppercase text-[8px] bg-emerald-950/20 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                        ✓ Verified
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">URL Link Randomizer (v=XXX)</span>
                      <span className="text-emerald-400 flex items-center gap-1 font-mono uppercase text-[8px] bg-emerald-950/20 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                        ✓ Enabled
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Opt-Out STOP Triggers</span>
                      <span className="text-emerald-400 flex items-center gap-1 font-mono uppercase text-[8px] bg-emerald-950/20 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                        ✓ Compliant
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">API Key Authentication</span>
                      <span className="text-emerald-400 flex items-center gap-1 font-mono uppercase text-[8px] bg-emerald-950/20 border border-emerald-900/30 px-1.5 py-0.5 rounded">
                        ✓ Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* DiagnosticLogs */}
                <div className="space-y-2">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-550 select-none">Diagnostic Spam Logs</span>
                  
                  {loadingCrm && carrierLogs.length === 0 ? (
                    <div className="py-8 text-center text-zinc-650">
                      <div className="w-4 h-4 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
                      <span className="text-[9px] uppercase font-bold tracking-wider">Syncing diagnostics...</span>
                    </div>
                  ) : carrierLogs.length === 0 ? (
                    <div className="py-8 text-center text-zinc-700 select-none text-[10px]">
                      Zero active carrier blocks detected.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
                      {carrierLogs.map((log) => {
                        const urlMatch = log.messageText ? log.messageText.match(/https?:\/\/[^\s]+/i) : null;
                        const linkBody = urlMatch ? urlMatch[0] : null;
                        return (
                          <div key={log.id} className="p-2.5 bg-zinc-900/10 border border-zinc-900 rounded-xl text-left space-y-1.5">
                            <div className="flex justify-between items-baseline font-mono text-[8px] text-zinc-500">
                              <span>{log.phoneNumber}</span>
                              <span>{new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })} {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div className="text-[10px] text-red-400 font-semibold flex justify-between items-center">
                              <span>{log.carrier || 'Carrier'} Filter</span>
                              <span className="bg-red-950/40 border border-red-900/50 px-1 py-0.5 rounded text-[8px] font-bold font-mono">Code {log.code || 'N/A'}</span>
                            </div>
                            <p className="text-[10px] text-zinc-450 font-normal leading-relaxed">{log.reason}</p>
                            {linkBody && (
                              <div className="p-1.5 bg-zinc-950 border border-zinc-900 rounded text-[8px] font-mono text-amber-500 break-all select-all">
                                🔗 {linkBody}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ======================================================== */}
      {/* Sleek inline Direct Message Modal */}
      {/* ======================================================== */}
      {showDirectMessageModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 select-text">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-900 shadow-2xl rounded-[2.5rem] p-6 relative text-left">
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider mb-4 select-none">
              Start Direct Message
            </h3>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Lead Phone Number (Required)</label>
                <input
                  type="text"
                  placeholder="e.g. +14155552671"
                  value={dmPhoneInput}
                  onChange={(e) => setDmPhoneInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-350 focus:outline-none focus:border-zinc-800 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Lead Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={dmNameInput}
                  onChange={(e) => setDmNameInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Initial Text Message (Required)</label>
                <textarea
                  placeholder="Type the message you want to send..."
                  value={dmTextInput}
                  onChange={(e) => setDmTextInput(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-6 select-none">
              <button
                onClick={() => {
                  setShowDirectMessageModal(false);
                  setDmPhoneInput('');
                  setDmNameInput('');
                  setDmTextInput('');
                }}
                className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleDirectMessage}
                disabled={dmSending || !dmPhoneInput.trim() || !dmTextInput.trim()}
                className="flex-1 py-2.5 bg-emerald-500 text-black hover:bg-emerald-400 disabled:bg-zinc-900 disabled:text-zinc-650 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                {dmSending ? 'Dispatching...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CONTACT CREATION / EDITING MODAL */}
      {/* ======================================================== */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-center justify-center p-3 sm:p-4 select-text">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-900 shadow-2xl rounded-[2.5rem] p-6 relative text-left">
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider mb-4 select-none">
              {editingContact ? 'Edit Lead' : 'Add New Lead'}
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Contact Name</label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={contactNameInput}
                  onChange={(e) => setContactNameInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Phone Number (Required)</label>
                <input
                  type="text"
                  placeholder="e.g. +14155552671"
                  value={contactPhoneInput}
                  onChange={(e) => setContactPhoneInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-350 focus:outline-none focus:border-zinc-800 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Tags (Comma Separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Lead, Follow-up, Cold"
                  value={contactTagsInput}
                  onChange={(e) => setContactTagsInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-350 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. john@company.com"
                  value={contactEmailInput}
                  onChange={(e) => setContactEmailInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Company / Affiliation</label>
                <input
                  type="text"
                  placeholder="e.g. Acme Corp"
                  value={contactCompanyInput}
                  onChange={(e) => setContactCompanyInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">CRM Notes</label>
                <textarea
                  placeholder="Enter notes about this lead..."
                  value={contactNotesInput}
                  onChange={(e) => setContactNotesInput(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-6 select-none">
              <button
                onClick={() => {
                  setShowContactModal(false);
                  setEditingContact(null);
                }}
                className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-850 border border-zinc-805 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContact}
                className="flex-1 py-2 bg-emerald-500 text-black hover:bg-emerald-400 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Save Lead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TEMPLATE CREATION MODAL */}
      {/* ======================================================== */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-center justify-center p-3 sm:p-4 select-text">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-900 shadow-2xl rounded-[2.5rem] p-6 relative text-left">
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider mb-4 select-none">
              Create Campaign Template
            </h3>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550 select-none">Template Name</label>
                <input
                  type="text"
                  placeholder="e.g. Product Pitch"
                  value={templateNameInput}
                  onChange={(e) => setTemplateNameInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-baseline select-none">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-550">Template Body</label>
                  <span className="text-[8px] text-zinc-655 font-bold">Use {"{Name}"} placeholder</span>
                </div>
                <textarea
                  placeholder="e.g. Hi {Name}, check out our services..."
                  value={templateContentInput}
                  onChange={(e) => setTemplateContentInput(e.target.value)}
                  rows={4}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800 resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2.5 mt-6 select-none">
              <button
                onClick={() => {
                  setShowTemplateModal(false);
                  setTemplateNameInput('');
                  setTemplateContentInput('');
                }}
                className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-850 border border-zinc-805 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                className="flex-1 py-2 bg-emerald-500 text-black hover:bg-emerald-400 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
              >
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

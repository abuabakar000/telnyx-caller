'use client';

import dynamic from 'next/dynamic';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  PhoneCall, TrendingUp, Phone, Voicemail, ThumbsUp,
  Users, Layers, ChevronLeft, ChevronRight, X
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import LeadQueue from '@/components/LeadQueue';
import KanbanPipeline from '@/components/KanbanPipeline';
import ExcelImport from '@/components/ExcelImport';
import DispositionModal from '@/components/DispositionModal';
import CallScriptSidebar from '@/components/CallScriptSidebar';
import LeadTimeline from '@/components/LeadTimeline';
import type { Lead } from '@/components/LeadQueue';
import {
  getLeads,
  updateLeadStatus,
  addLeadEvent,
  getDashboardStats,
} from '@/app/actions/leads';
import { sendSMS } from '@/app/actions/sms';
import { getTemplates } from '@/app/actions/templates';

// Dynamic import — Dialer is WebRTC client-only
const Dialer = dynamic(() => import('@/components/Dialer'), {
  ssr: false,
  loading: () => (
    <div className="w-full max-w-md bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2.5rem] p-6 sm:p-8 flex flex-col justify-center items-center min-h-[500px]">
      <div className="relative flex items-center justify-center">
        <div className="absolute w-12 h-12 border-2 border-zinc-800 rounded-full animate-ping" />
        <PhoneCall className="w-6 h-6 text-zinc-500 animate-pulse" />
      </div>
      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mt-6 animate-pulse">
        Securing Line...
      </span>
    </div>
  ),
});

interface DashboardStats {
  totalCalls: number;
  connected: number;
  vmDrops: number;
  interested: number;
  connectRate: number;
}

const COUNTDOWN_SECONDS = 3;

export default function Home() {
  // Lead data
  const [leads, setLeads] = useState<Lead[]>([]);

  // Power Dialer state
  const [powerDialerActive, setPowerDialerActive] = useState(false);
  const [powerDialerPaused, setPowerDialerPaused] = useState(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  // Disposition
  const [showDisposition, setShowDisposition] = useState(false);
  const [lastCallDuration, setLastCallDuration] = useState(0);

  // Script sidebar
  const [scriptOpen, setScriptOpen] = useState(false);

  // Panel drawers
  const [showLeadQueue, setShowLeadQueue] = useState(false);
  const [showKanban, setShowKanban] = useState(false);

  // Modals
  const [showImport, setShowImport] = useState(false);
  const [timelineLead, setTimelineLead] = useState<Lead | null>(null);

  // Dashboard stats
  const [dashStats, setDashStats] = useState<DashboardStats>({
    totalCalls: 0, connected: 0, vmDrops: 0, interested: 0, connectRate: 0
  });

  // Templates for SMS auto follow-up
  const [smsTemplates, setSmsTemplates] = useState<{ id: string; name: string; content: string }[]>([]);

  useEffect(() => {
    loadLeads();
    loadStats();
    getTemplates().then(res => {
      if (res.success && res.templates) setSmsTemplates(res.templates as any);
    });
  }, []);

  useEffect(() => {
    const id = setInterval(loadStats, 30000);
    return () => clearInterval(id);
  }, []);

  const loadLeads = async () => {
    const res = await getLeads();
    if (res.success && res.leads) setLeads(res.leads as Lead[]);
  };

  const loadStats = async () => {
    const res = await getDashboardStats();
    if (res.success && res.stats) setDashStats(res.stats);
  };

  const queueLeads = leads.filter(l => l.status === 'New' || l.status === 'Contacted');

  // ─── Power Dialer ────────────────────────────────────────────────────────

  const startCountdown = useCallback((afterIdx: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdownSeconds(COUNTDOWN_SECONDS);
    let remaining = COUNTDOWN_SECONDS;

    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdownSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdownSeconds(null);
        const nextLead = queueLeads[afterIdx];
        if (nextLead) {
          setActiveLead(nextLead);
          setCurrentQueueIndex(afterIdx);
        } else {
          setPowerDialerActive(false);
          setActiveLead(null);
        }
      }
    }, 1000);
  }, [queueLeads]);

  const handleStartPowerDialer = () => {
    if (queueLeads.length === 0) return;
    setPowerDialerActive(true);
    setPowerDialerPaused(false);
    setActiveLead(queueLeads[0]);
    setCurrentQueueIndex(0);
    setShowLeadQueue(true);
  };

  const handlePausePowerDialer = () => {
    if (powerDialerPaused) {
      setPowerDialerPaused(false);
    } else {
      setPowerDialerPaused(true);
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      setCountdownSeconds(null);
    }
  };

  const handleSkipLead = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdownSeconds(null);
    const nextIdx = currentQueueIndex + 1;
    if (nextIdx < queueLeads.length) {
      setActiveLead(queueLeads[nextIdx]);
      setCurrentQueueIndex(nextIdx);
    } else {
      setPowerDialerActive(false);
      setActiveLead(null);
    }
  };

  const handleCallEnded = useCallback((duration: number) => {
    setLastCallDuration(duration);
    if (activeLead && powerDialerActive) setShowDisposition(true);
    loadStats();
  }, [activeLead, powerDialerActive]);

  // ─── Disposition ─────────────────────────────────────────────────────────

  const handleDispositionSubmit = async (result: {
    disposition: string;
    callbackAt?: string;
    sendSms: boolean;
  }) => {
    setShowDisposition(false);
    if (!activeLead) return;

    const statusMap: Record<string, string> = {
      'Interested': 'Interested',
      'Callback': 'Callback',
      'No Answer': 'Contacted',
      'VM Left': 'Contacted',
      'Not Interested': 'Closed',
    };
    const newStatus = statusMap[result.disposition] || 'Contacted';

    await updateLeadStatus(activeLead.id, newStatus, result.disposition, result.callbackAt || null);
    await addLeadEvent(activeLead.id, 'call', {
      direction: 'outbound',
      disposition: result.disposition,
      duration: lastCallDuration,
    });

    if (result.sendSms && smsTemplates.length > 0) {
      const text = smsTemplates[0].content
        .replace(/\{firstName\}/g, activeLead.firstName)
        .replace(/\{companyName\}/g, activeLead.company || 'your company');
      await sendSMS(activeLead.phone, text);
      await addLeadEvent(activeLead.id, 'sms', { direction: 'outbound', text });
    }

    await loadLeads();
    loadStats();
    if (!powerDialerPaused) startCountdown(currentQueueIndex + 1);
  };

  // ─── Lead Actions ────────────────────────────────────────────────────────

  const handleLeadDrop = async (leadId: string, newStatus: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
    await updateLeadStatus(leadId, newStatus);
  };

  const handleSaveNotes = async (leadId: string, notes: string) => {
    await updateLeadStatus(leadId, leads.find(l => l.id === leadId)?.status || 'New', undefined, undefined, notes);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, notes } : l));
  };

  const handleImportComplete = async () => {
    await loadLeads();
  };

  const handleClearLeads = () => {
    setPowerDialerActive(false);
    setActiveLead(null);
    setCountdownSeconds(null);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setLeads([]);
  };

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const STAT_ITEMS = [
    { label: 'Calls Today', value: dashStats.totalCalls, icon: Phone, color: 'text-zinc-300' },
    { label: 'Connected', value: dashStats.connected, icon: PhoneCall, color: 'text-[#00c896]' },
    { label: 'VM Drops', value: dashStats.vmDrops, icon: Voicemail, color: 'text-amber-400' },
    { label: 'Interested', value: dashStats.interested, icon: ThumbsUp, color: 'text-[#00c896]' },
    { label: 'Connect Rate', value: `${dashStats.connectRate}%`, icon: TrendingUp, color: dashStats.connectRate >= 20 ? 'text-[#00c896]' : dashStats.connectRate >= 10 ? 'text-amber-400' : 'text-red-400' },
  ];

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center gap-4 p-2 sm:p-4 relative selection:bg-zinc-800">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(24,24,27,0.4)_0%,transparent_100%)] pointer-events-none" />

      {/* Navbar */}
      <Navbar />

      {/* ─── Dashboard Stats Bar ───────────────────────────────── */}
      <div className="z-10 w-full max-w-6xl">
        <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 rounded-2xl px-5 py-3 flex items-center gap-6">
          {STAT_ITEMS.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="flex items-center gap-2 flex-1">
                <div className="p-1.5 rounded-lg bg-zinc-900/60 border border-zinc-900 shrink-0">
                  <Icon size={11} className="text-zinc-500" />
                </div>
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-wider text-zinc-600 leading-none">{stat.label}</p>
                  <p className={`text-sm font-bold font-mono mt-0.5 ${stat.color}`}>{stat.value}</p>
                </div>
              </div>
            );
          })}

          {/* Panel toggle buttons inside stat bar */}
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button
              onClick={() => { setShowLeadQueue(v => !v); setShowKanban(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all ${
                showLeadQueue
                  ? 'bg-[#00c896]/10 border-[#00c896]/30 text-[#00c896]'
                  : 'bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Users size={11} />
              Leads {leads.length > 0 && <span className="font-mono">{leads.length}</span>}
            </button>
            <button
              onClick={() => { setShowKanban(v => !v); setShowLeadQueue(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-all ${
                showKanban
                  ? 'bg-[#00c896]/10 border-[#00c896]/30 text-[#00c896]'
                  : 'bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Layers size={11} />
              Pipeline
            </button>
          </div>
        </div>
      </div>

      {/* ─── Main area: Dialer centered ────────────────────────── */}
      <main className="z-10 w-full max-w-6xl flex-grow flex justify-center items-start pb-6">
        <div className="w-full flex justify-center">
          <Dialer
            activeLead={activeLead ? {
              id: activeLead.id,
              firstName: activeLead.firstName,
              lastName: activeLead.lastName,
              phone: activeLead.phone,
              company: activeLead.company,
            } : null}
            onCallEnded={handleCallEnded}
            onScriptToggle={() => setScriptOpen(prev => !prev)}
            scriptOpen={scriptOpen}
          />
        </div>
      </main>

      {/* ─── Lead Queue Panel (Floating Left Drawer) ────────────────────────── */}
      {showLeadQueue && (
        <div className="fixed inset-0 z-50 flex pointer-events-none">
          {/* Backdrop (clickable to close) */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity pointer-events-auto" 
            onClick={() => setShowLeadQueue(false)} 
          />
          {/* Floating Card Container */}
          <div className="relative mr-auto ml-4 my-4 w-[22rem] h-[calc(100vh-2rem)] flex flex-col pointer-events-auto animate-slide-in-left">
            {/* External close button */}
            <button
              onClick={() => setShowLeadQueue(false)}
              className="absolute -right-12 top-4 z-50 p-2 rounded-xl bg-zinc-950/80 backdrop-blur-md border border-zinc-900 text-zinc-400 hover:text-zinc-200 shadow-xl transition-all hover:scale-105"
              title="Close Queue"
            >
              <X size={16} />
            </button>
            <LeadQueue
              leads={leads}
              activeLeadId={activeLead?.id || null}
              powerDialerActive={powerDialerActive}
              powerDialerPaused={powerDialerPaused}
              currentQueueIndex={currentQueueIndex}
              countdownSeconds={countdownSeconds}
              onSelectLead={(lead) => setActiveLead(lead)}
              onStartPowerDialer={handleStartPowerDialer}
              onPausePowerDialer={handlePausePowerDialer}
              onSkipLead={handleSkipLead}
              onImportClick={() => setShowImport(true)}
              onOpenTimeline={(lead) => setTimelineLead(lead)}
              onClearLeads={handleClearLeads}
            />
          </div>
        </div>
      )}

      {/* ─── Kanban Pipeline Panel (Floating Right Drawer) ────────────────────── */}
      {showKanban && (
        <div className="fixed inset-0 z-50 flex pointer-events-none">
          {/* Backdrop (clickable to close) */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity pointer-events-auto" 
            onClick={() => setShowKanban(false)} 
          />
          {/* Floating Card Container */}
          <div className="relative ml-auto mr-4 my-4 w-[24rem] h-[calc(100vh-2rem)] flex flex-col pointer-events-auto animate-slide-in-right">
            {/* External close button */}
            <button
              onClick={() => setShowKanban(false)}
              className="absolute -left-12 top-4 z-50 p-2 rounded-xl bg-zinc-950/80 backdrop-blur-md border border-zinc-900 text-zinc-400 hover:text-zinc-200 shadow-xl transition-all hover:scale-105"
              title="Close Pipeline"
            >
              <X size={16} />
            </button>
            <KanbanPipeline
              leads={leads}
              onLeadDrop={handleLeadDrop}
              onOpenTimeline={(lead) => setTimelineLead(lead)}
            />
          </div>
        </div>
      )}

      {/* ─── Call Script — full-screen overlay modal ──────────── */}
      {scriptOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setScriptOpen(false)} />
          {/* Panel slides in from right */}
          <div className="relative ml-auto w-80 h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl animate-[slideInRight_0.2s_ease-out]">
            <CallScriptSidebar
              isOpen={true}
              onToggle={() => setScriptOpen(false)}
              leadFirstName={activeLead?.firstName}
              leadCompany={activeLead?.company}
            />
          </div>
        </div>
      )}

      {/* ─── Modals ─────────────────────────────────────────────── */}
      {showImport && (
        <ExcelImport
          onImportComplete={handleImportComplete}
          onClose={() => setShowImport(false)}
        />
      )}

      {showDisposition && activeLead && (
        <DispositionModal
          leadName={`${activeLead.firstName} ${activeLead.lastName}`.trim()}
          leadPhone={activeLead.phone}
          leadCompany={activeLead.company}
          callDuration={lastCallDuration}
          onSubmit={handleDispositionSubmit}
          onClose={() => {
            setShowDisposition(false);
            if (!powerDialerPaused) startCountdown(currentQueueIndex + 1);
          }}
        />
      )}

      {timelineLead && (
        <LeadTimeline
          lead={timelineLead}
          onClose={() => setTimelineLead(null)}
          onSaveNotes={handleSaveNotes}
        />
      )}

      <footer className="text-[10px] tracking-wider text-zinc-650 font-semibold uppercase z-10 select-none pb-4">
        Powered by Inex Labs Voice Engine
      </footer>
    </div>
  );
}

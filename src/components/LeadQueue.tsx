'use client';

import React, { useEffect, useRef } from 'react';
import { 
  Phone, Upload, Users, ChevronRight, Building2, Clock, 
  SkipForward, Pause, Play, AlertCircle, Trash2
} from 'lucide-react';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  company?: string | null;
  email?: string | null;
  status: string;
  disposition?: string | null;
  callbackAt?: string | Date | null;
  notes?: string | null;
  createdAt: string | Date;
}

interface LeadQueueProps {
  leads: Lead[];
  activeLeadId: string | null;
  powerDialerActive: boolean;
  powerDialerPaused: boolean;
  currentQueueIndex: number;
  countdownSeconds: number | null;
  onSelectLead: (lead: Lead) => void;
  onStartPowerDialer: () => void;
  onPausePowerDialer: () => void;
  onSkipLead: () => void;
  onImportClick: () => void;
  onOpenTimeline: (lead: Lead) => void;
  onClearLeads: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-zinc-900 text-zinc-400 border-zinc-800',
  'Contacted': 'bg-blue-950/30 text-blue-400 border-blue-900/40',
  'Callback': 'bg-amber-950/30 text-amber-400 border-amber-900/40',
  'Interested': 'bg-[#00c896]/10 text-[#00c896] border-[#00c896]/30',
  'Closed': 'bg-zinc-900/60 text-zinc-600 border-zinc-800',
};

export default function LeadQueue({
  leads,
  activeLeadId,
  powerDialerActive,
  powerDialerPaused,
  currentQueueIndex,
  countdownSeconds,
  onSelectLead,
  onStartPowerDialer,
  onPausePowerDialer,
  onSkipLead,
  onImportClick,
  onOpenTimeline,
  onClearLeads,
}: LeadQueueProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeLeadId]);

  const queueLeads = leads.filter(l => l.status === 'New' || l.status === 'Contacted');
  const dialedLeads = leads.filter(l => l.status !== 'New' && l.status !== 'Contacted');

  return (
    <div className="w-full h-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 flex flex-col" style={{ minHeight: '580px' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <Users size={13} className="text-zinc-500" />
          <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400">Lead Queue</h2>
          {leads.length > 0 && (
            <span className="text-[9px] font-bold bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-400">
              {leads.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {leads.length > 0 && (
            <button
              onClick={onClearLeads}
              className="p-1 text-zinc-700 hover:text-red-400 transition-colors"
              title="Clear all leads"
            >
              <Trash2 size={11} />
            </button>
          )}
          <button
            onClick={onImportClick}
            className="flex items-center gap-1 px-2.5 py-1 bg-[#00c896]/10 border border-[#00c896]/20 text-[#00c896] rounded-lg text-[9px] font-bold uppercase tracking-wider hover:bg-[#00c896]/20 transition-all"
          >
            <Upload size={10} /> Import
          </button>
        </div>
      </div>

      {/* Power Dialer Controls */}
      {leads.length > 0 && (
        <div className="mb-3 p-3 bg-zinc-900/30 border border-zinc-900 rounded-2xl space-y-2">
          {/* Progress indicator */}
          <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-wider">
            <span className="text-zinc-500">Power Dialer</span>
            <span className="text-zinc-400 font-mono">
              {Math.min(currentQueueIndex + 1, queueLeads.length)} / {queueLeads.length} in queue
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00c896] rounded-full transition-all duration-300"
              style={{ width: `${queueLeads.length > 0 ? (currentQueueIndex / queueLeads.length) * 100 : 0}%` }}
            />
          </div>

          {/* Countdown timer */}
          {countdownSeconds !== null && (
            <div className="flex items-center gap-2 justify-center py-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400">
                <Clock size={11} className="animate-pulse" />
                Next call in <span className="font-mono text-amber-300">{countdownSeconds}s</span>
              </div>
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex gap-2">
            {!powerDialerActive ? (
              <button
                onClick={onStartPowerDialer}
                disabled={queueLeads.length === 0}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#00c896] text-black rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-[#00b386] disabled:bg-zinc-800 disabled:text-zinc-600 transition-all active:scale-95"
              >
                <Play size={10} fill="currentColor" />
                Start Dialer
              </button>
            ) : (
              <>
                <button
                  onClick={onPausePowerDialer}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${
                    powerDialerPaused
                      ? 'bg-[#00c896] text-black hover:bg-[#00b386]'
                      : 'bg-amber-950/30 border border-amber-900/40 text-amber-400 hover:bg-amber-950/50'
                  }`}
                >
                  {powerDialerPaused ? <Play size={10} fill="currentColor" /> : <Pause size={10} fill="currentColor" />}
                  {powerDialerPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={onSkipLead}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-zinc-800 transition-all active:scale-95"
                >
                  <SkipForward size={10} />
                  Skip
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Lead List */}
      <div className="flex-grow overflow-y-auto space-y-1.5 pr-0.5" style={{ maxHeight: '340px' }}>
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-zinc-700">
            <Users size={28} className="opacity-10 mb-3" />
            <p className="text-xs font-bold uppercase tracking-wider">No leads loaded</p>
            <button
              onClick={onImportClick}
              className="mt-3 text-[10px] text-[#00c896] hover:underline font-bold"
            >
              Import from Excel →
            </button>
          </div>
        ) : (
          <>
            {queueLeads.length > 0 && (
              <div className="text-[8px] uppercase font-bold tracking-widest text-zinc-600 px-1 pb-1">In Queue</div>
            )}
            {queueLeads.map((lead, idx) => {
              const isActive = lead.id === activeLeadId;
              const fullName = `${lead.firstName} ${lead.lastName}`.trim() || lead.phone;
              const initials = [lead.firstName[0], lead.lastName[0]].filter(Boolean).join('').toUpperCase() || '#';

              return (
                <div
                  key={lead.id}
                  ref={isActive ? activeRef : null}
                  className={`group flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all duration-150 ${
                    isActive
                      ? 'bg-[#00c896]/10 border-[#00c896]/30'
                      : 'bg-zinc-900/10 border-zinc-900/50 hover:bg-zinc-900/40 hover:border-zinc-800/40'
                  }`}
                  onClick={() => onSelectLead(lead)}
                >
                  {/* Queue position */}
                  <span className="text-[9px] font-mono text-zinc-600 shrink-0 w-4 text-center">{idx + 1}</span>

                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                    isActive ? 'bg-[#00c896]/20 text-[#00c896]' : 'bg-zinc-900 text-zinc-500'
                  }`}>
                    {initials}
                  </div>

                  <div className="flex-grow min-w-0">
                    <div className="flex items-baseline justify-between gap-1">
                      <p className={`text-[11px] font-semibold truncate ${isActive ? 'text-[#00c896]' : 'text-zinc-300'}`}>
                        {fullName}
                      </p>
                      <span className={`text-[8px] font-bold border px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLORS[lead.status] || STATUS_COLORS['New']}`}>
                        {lead.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {lead.company && (
                        <span className="text-[9px] text-zinc-600 flex items-center gap-0.5">
                          <Building2 size={8} /> {lead.company}
                        </span>
                      )}
                      {!lead.company && (
                        <span className="text-[9px] text-zinc-600 font-mono">{lead.phone}</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenTimeline(lead); }}
                    className="p-1 rounded text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
                    title="View timeline"
                  >
                    <ChevronRight size={11} />
                  </button>
                </div>
              );
            })}

            {dialedLeads.length > 0 && (
              <>
                <div className="text-[8px] uppercase font-bold tracking-widest text-zinc-600 px-1 pb-1 pt-2 border-t border-zinc-900/50 mt-2">
                  Dialed
                </div>
                {dialedLeads.slice(0, 10).map((lead) => {
                  const fullName = `${lead.firstName} ${lead.lastName}`.trim() || lead.phone;
                  const initials = [lead.firstName[0], lead.lastName[0]].filter(Boolean).join('').toUpperCase() || '#';
                  return (
                    <div
                      key={lead.id}
                      className="group flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-900/30 bg-zinc-900/5 opacity-60 hover:opacity-100 cursor-pointer transition-all"
                      onClick={() => onOpenTimeline(lead)}
                    >
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 bg-zinc-900 text-zinc-600">
                        {initials}
                      </div>
                      <div className="flex-grow min-w-0">
                        <p className="text-[11px] font-semibold text-zinc-500 truncate">{fullName}</p>
                        {lead.disposition && (
                          <span className="text-[9px] text-zinc-600">{lead.disposition}</span>
                        )}
                      </div>
                      <span className={`text-[8px] font-bold border px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLORS[lead.status] || STATUS_COLORS['New']}`}>
                        {lead.status}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

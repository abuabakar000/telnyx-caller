'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Phone, MessageSquare, FileText, Clock, 
  ThumbsUp, Calendar, PhoneMissed, Voicemail, ThumbsDown,
  Building2, Mail, CheckCircle2, AlertCircle
} from 'lucide-react';
import { getLeadTimeline } from '@/app/actions/leads';
import type { Lead } from './LeadQueue';

interface LeadTimelineProps {
  lead: Lead;
  onClose: () => void;
  onSaveNotes: (leadId: string, notes: string) => void;
}

interface TimelineEvent {
  id: string;
  leadId: string;
  type: string;
  direction?: string | null;
  disposition?: string | null;
  duration?: number | null;
  text?: string | null;
  timestamp: string | Date;
}

interface SmsMessage {
  id: string;
  direction: string;
  text: string;
  status: string;
  timestamp: string | Date;
}

const DISP_ICON: Record<string, any> = {
  'Interested': ThumbsUp,
  'Callback': Calendar,
  'No Answer': PhoneMissed,
  'VM Left': Voicemail,
  'Not Interested': ThumbsDown,
};

const DISP_COLOR: Record<string, string> = {
  'Interested': 'text-[#00c896] bg-[#00c896]/10 border-[#00c896]/20',
  'Callback': 'text-blue-400 bg-blue-950/20 border-blue-900/30',
  'No Answer': 'text-zinc-400 bg-zinc-900/30 border-zinc-800',
  'VM Left': 'text-amber-400 bg-amber-950/20 border-amber-900/30',
  'Not Interested': 'text-red-400 bg-red-950/20 border-red-900/30',
};

function formatDuration(s?: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatTimestamp(ts: string | Date): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LeadTimeline({ lead, onClose, onSaveNotes }: LeadTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState(lead.notes || '');
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef<NodeJS.Timeout | null>(null);

  const fullName = `${lead.firstName} ${lead.lastName}`.trim() || lead.phone;
  const initials = [lead.firstName[0], lead.lastName[0]].filter(Boolean).join('').toUpperCase() || '#';

  useEffect(() => {
    setLoading(true);
    getLeadTimeline(lead.id).then((res) => {
      if (res.success) {
        setEvents((res.events || []) as TimelineEvent[]);
        setSmsMessages((res.smsMessages || []) as SmsMessage[]);
      }
      setLoading(false);
    });
  }, [lead.id]);

  const handleNotesBlur = () => {
    if (notes !== lead.notes) {
      onSaveNotes(lead.id, notes);
      setNotesSaved(true);
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => setNotesSaved(false), 2000);
    }
  };

  // Build unified timeline
  const allItems = [
    ...events.map(e => ({ ...e, _source: 'event' as const })),
    ...smsMessages.map(m => ({
      id: m.id,
      leadId: lead.id,
      type: 'sms',
      direction: m.direction,
      disposition: null,
      duration: null,
      text: m.text,
      timestamp: m.timestamp,
      status: m.status,
      _source: 'sms' as const,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[75] flex items-center justify-end p-4">
      <div className="w-full max-w-sm h-full max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-900">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Lead Timeline</span>
            <button onClick={onClose} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors">
              <X size={13} />
            </button>
          </div>

          {/* Lead card */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00c896]/10 border border-[#00c896]/20 flex items-center justify-center font-bold text-sm text-[#00c896] shrink-0">
              {initials}
            </div>
            <div className="flex-grow min-w-0">
              <h3 className="text-sm font-bold text-zinc-100 truncate">{fullName}</h3>
              <div className="flex flex-wrap gap-2 mt-0.5">
                {lead.company && (
                  <span className="text-[9px] text-zinc-500 flex items-center gap-1">
                    <Building2 size={9} />{lead.company}
                  </span>
                )}
                {lead.email && (
                  <span className="text-[9px] text-zinc-500 flex items-center gap-1">
                    <Mail size={9} />{lead.email}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-zinc-600 font-mono mt-0.5">{lead.phone}</p>
            </div>
          </div>

          {/* Disposition badge */}
          {lead.disposition && (
            <div className={`mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold ${DISP_COLOR[lead.disposition] || 'text-zinc-400 bg-zinc-900 border-zinc-800'}`}>
              {DISP_ICON[lead.disposition] && React.createElement(DISP_ICON[lead.disposition], { size: 11 })}
              {lead.disposition}
              {lead.callbackAt && (
                <span className="text-[9px] ml-1 opacity-70">
                  · {new Date(lead.callbackAt).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="px-5 py-3 border-b border-zinc-900">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Agent Notes</label>
            {notesSaved && (
              <span className="text-[9px] text-[#00c896] flex items-center gap-1">
                <CheckCircle2 size={9} /> Saved
              </span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Add notes about this lead..."
            rows={2}
            className="w-full bg-zinc-900/30 border border-zinc-900 rounded-xl px-3 py-2 text-[11px] text-zinc-300 focus:outline-none focus:border-zinc-700 resize-none placeholder-zinc-700"
          />
        </div>

        {/* Timeline */}
        <div className="flex-grow overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600">
              <div className="w-4 h-4 border-2 border-zinc-700 border-t-[#00c896] rounded-full animate-spin mb-2" />
              <span className="text-[9px] uppercase font-bold tracking-wider">Loading timeline...</span>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-700 py-12">
              <Clock size={24} className="opacity-20 mb-3" />
              <p className="text-xs">No activity recorded yet</p>
            </div>
          ) : (
            <div className="relative space-y-0">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-zinc-900" />

              {allItems.map((item) => {
                const isCall = item.type === 'call';
                const isSms = item.type === 'sms';
                const isNote = item.type === 'note';
                const DispIcon = item.disposition ? (DISP_ICON[item.disposition] || AlertCircle) : null;

                return (
                  <div key={item.id} className="flex gap-3 pb-4 pl-2">
                    {/* Timeline dot */}
                    <div className={`relative z-10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      isCall ? 'bg-zinc-900 border border-zinc-700' :
                      isSms ? 'bg-blue-950/40 border border-blue-900/50' :
                      'bg-zinc-900 border border-zinc-800'
                    }`}>
                      {isCall && <Phone size={9} className="text-zinc-400" />}
                      {isSms && <MessageSquare size={9} className="text-blue-400" />}
                      {isNote && <FileText size={9} className="text-zinc-500" />}
                    </div>

                    {/* Event card */}
                    <div className="flex-grow min-w-0 pb-3 border-b border-zinc-900/50">
                      <div className="flex items-baseline justify-between gap-1 mb-1">
                        <span className="text-[10px] font-bold text-zinc-300 capitalize">
                          {isCall ? `${item.direction === 'outbound' ? 'Outgoing' : 'Incoming'} Call` :
                           isSms ? `${item.direction === 'outbound' ? '→' : '←'} SMS` :
                           'Note'}
                        </span>
                        <span className="text-[8px] text-zinc-600 font-mono shrink-0">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      </div>

                      {isCall && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.duration !== null && (
                            <span className="text-[9px] text-zinc-500 flex items-center gap-1">
                              <Clock size={8} /> {formatDuration(item.duration)}
                            </span>
                          )}
                          {item.disposition && (
                            <span className={`text-[8px] font-bold border px-1.5 py-0.5 rounded-full ${DISP_COLOR[item.disposition] || 'text-zinc-500 border-zinc-800'}`}>
                              {DispIcon && React.createElement(DispIcon, { size: 8, className: 'inline mr-0.5' })}
                              {item.disposition}
                            </span>
                          )}
                        </div>
                      )}

                      {isSms && item.text && (
                        <p className="text-[10px] text-zinc-500 leading-relaxed mt-0.5 line-clamp-2">
                          {item.text}
                        </p>
                      )}

                      {isNote && item.text && (
                        <p className="text-[10px] text-zinc-500 italic mt-0.5">{item.text}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

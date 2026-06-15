'use client';

import React, { useState } from 'react';
import { 
  Phone, X, ThumbsUp, Calendar, PhoneMissed, Voicemail, 
  ThumbsDown, MessageSquare, Clock
} from 'lucide-react';

export interface DispositionResult {
  disposition: string;
  callbackAt?: string;
  sendSms: boolean;
}

interface DispositionModalProps {
  leadName: string;
  leadPhone: string;
  leadCompany?: string | null;
  callDuration: number;
  onSubmit: (result: DispositionResult) => void;
  onClose: () => void;
}

const DISPOSITIONS = [
  { 
    key: 'Interested', 
    label: 'Interested', 
    icon: ThumbsUp, 
    color: 'bg-[#00c896]/10 border-[#00c896]/30 text-[#00c896] hover:bg-[#00c896]/20',
    sendSms: true,
    description: 'Auto-sends follow-up SMS'
  },
  { 
    key: 'Callback', 
    label: 'Callback', 
    icon: Calendar, 
    color: 'bg-blue-950/30 border-blue-900/40 text-blue-400 hover:bg-blue-950/50',
    sendSms: true,
    description: 'Schedules follow-up SMS'
  },
  { 
    key: 'No Answer', 
    label: 'No Answer', 
    icon: PhoneMissed, 
    color: 'bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:bg-zinc-800',
    sendSms: false,
    description: 'Move to next lead'
  },
  { 
    key: 'VM Left', 
    label: 'VM Left', 
    icon: Voicemail, 
    color: 'bg-amber-950/20 border-amber-900/30 text-amber-400 hover:bg-amber-950/40',
    sendSms: false,
    description: 'Voicemail was left'
  },
  { 
    key: 'Not Interested', 
    label: 'Not Interested', 
    icon: ThumbsDown, 
    color: 'bg-red-950/20 border-red-900/30 text-red-400 hover:bg-red-950/40',
    sendSms: false,
    description: 'Mark as closed'
  },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function DispositionModal({
  leadName,
  leadPhone,
  leadCompany,
  callDuration,
  onSubmit,
  onClose,
}: DispositionModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [callbackDate, setCallbackDate] = useState('');
  const [callbackTime, setCallbackTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (disp: string, sendSms: boolean) => {
    if (submitting) return;
    setSubmitting(true);

    let callbackAt: string | undefined;
    if (disp === 'Callback' && callbackDate) {
      callbackAt = callbackTime
        ? `${callbackDate}T${callbackTime}`
        : `${callbackDate}T09:00`;
    }

    onSubmit({ disposition: disp, callbackAt, sendSms });
  };

  const initials = leadName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[80] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-[2rem] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-900">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Call Ended</span>
            <button onClick={onClose} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors">
              <X size={13} />
            </button>
          </div>

          {/* Lead Info */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00c896]/10 border border-[#00c896]/20 flex items-center justify-center text-[#00c896] font-bold text-xs shrink-0">
              {initials || '#'}
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-100">{leadName || leadPhone}</p>
              {leadCompany && <p className="text-[10px] text-zinc-500 mt-0.5">{leadCompany}</p>}
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{leadPhone}</p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-[10px] font-bold text-zinc-600 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-lg">
              <Clock size={10} />
              {formatDuration(callDuration)}
            </div>
          </div>
        </div>

        {/* Disposition Buttons */}
        <div className="p-5 space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 mb-3">Select Disposition</p>
          
          {DISPOSITIONS.map((disp) => {
            const Icon = disp.icon;
            const isSelected = selected === disp.key;

            return (
              <div key={disp.key}>
                <button
                  onClick={() => {
                    setSelected(disp.key);
                    if (disp.key !== 'Callback') {
                      handleSubmit(disp.key, disp.sendSms);
                    }
                  }}
                  disabled={submitting}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-150 active:scale-[0.98] disabled:opacity-50 ${disp.color} ${isSelected ? 'ring-1 ring-current ring-offset-0 ring-offset-transparent' : ''}`}
                >
                  <Icon size={15} className="shrink-0" />
                  <div className="flex-grow">
                    <p className="text-xs font-bold">{disp.label}</p>
                    {disp.sendSms && (
                      <p className="text-[9px] opacity-70 flex items-center gap-1 mt-0.5">
                        <MessageSquare size={8} /> {disp.description}
                      </p>
                    )}
                  </div>
                </button>

                {/* Callback Date Picker — inline expansion */}
                {disp.key === 'Callback' && selected === 'Callback' && (
                  <div className="mt-2 p-3 bg-blue-950/20 border border-blue-900/30 rounded-xl space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-blue-400">Schedule Callback</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-zinc-500 font-bold uppercase block mb-1">Date</label>
                        <input
                          type="date"
                          value={callbackDate}
                          onChange={(e) => setCallbackDate(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-700"
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-zinc-500 font-bold uppercase block mb-1">Time</label>
                        <input
                          type="time"
                          value={callbackTime}
                          onChange={(e) => setCallbackTime(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-700"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => handleSubmit('Callback', true)}
                      disabled={submitting}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50"
                    >
                      Confirm Callback
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Skip */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 text-zinc-600 hover:text-zinc-400 text-[10px] font-bold uppercase tracking-wider transition-colors"
          >
            Skip — No Disposition
          </button>
        </div>
      </div>
    </div>
  );
}

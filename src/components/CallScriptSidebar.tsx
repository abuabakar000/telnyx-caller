'use client';

import React, { useState } from 'react';
import { FileText, ChevronLeft, Edit3, Save, X } from 'lucide-react';

interface CallScriptSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  leadFirstName?: string;
  leadCompany?: string | null;
}

const DEFAULT_SCRIPTS = [
  {
    name: 'Cold Intro',
    content: `Hi {firstName}! This is [Your Name] calling.

I'm reaching out because we work with businesses like {companyName} to help them [VALUE PROP].

Quick question — is [PAIN POINT] something you're currently dealing with?

[LISTEN & RESPOND]

I'd love to schedule 15 minutes to show you how we've helped similar companies. Would [DAY] or [DAY] work for you?`
  },
  {
    name: 'Follow-Up',
    content: `Hi {firstName}, it's [Your Name] again.

I reached out last week about [TOPIC]. Wanted to follow up and see if you had a chance to think about it.

I know your time is valuable — this would only take 10 minutes and I think it could genuinely help {companyName}.

Would that be worth a quick chat?`
  },
  {
    name: 'VM Script',
    content: `Hi {firstName}, this is [Your Name] from [Company].

Calling about [BRIEF TOPIC]. We've been helping companies like {companyName} with [RESULT].

I'll send you a quick text with more details. Feel free to call back at [YOUR NUMBER].

Have a great day!`
  },
];

export default function CallScriptSidebar({
  isOpen,
  onToggle,
  leadFirstName = '',
  leadCompany = '',
}: CallScriptSidebarProps) {
  const [scriptIndex, setScriptIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [scripts, setScripts] = useState(DEFAULT_SCRIPTS);
  const [editContent, setEditContent] = useState('');

  const current = scripts[scriptIndex];

  const renderScript = (content: string) =>
    content
      .replace(/\{firstName\}/g, leadFirstName || 'there')
      .replace(/\{companyName\}/g, leadCompany || 'your company');

  const handleSave = () => {
    setScripts(prev => prev.map((s, i) => i === scriptIndex ? { ...s, content: editContent } : s));
    setIsEditing(false);
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-[#00c896]" />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Call Script</span>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <button onClick={handleSave} className="flex items-center gap-1 text-[10px] font-bold text-[#00c896] hover:text-[#00b386] px-2 py-1 bg-[#00c896]/10 rounded-lg">
              <Save size={11} /> Save
            </button>
          ) : (
            <button onClick={() => { setEditContent(current.content); setIsEditing(true); }} className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-all" title="Edit script">
              <Edit3 size={12} />
            </button>
          )}
          <button onClick={onToggle} className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-all">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex border-b border-zinc-900">
        {scripts.map((s, i) => (
          <button
            key={i}
            onClick={() => { setScriptIndex(i); setIsEditing(false); }}
            className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all ${
              scriptIndex === i
                ? 'bg-zinc-900 text-[#00c896] border-b-2 border-[#00c896]'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Active Lead Info */}
      {(leadFirstName || leadCompany) && (
        <div className="px-4 py-2 bg-[#00c896]/5 border-b border-[#00c896]/10 text-[9px] text-[#00c896] flex items-center gap-1.5">
          <span className="font-bold">Active Lead:</span>
          <span>{leadFirstName} {leadCompany ? `· ${leadCompany}` : ''}</span>
        </div>
      )}

      {/* Script Content */}
      <div className="flex-grow overflow-y-auto p-4">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full min-h-[400px] bg-transparent text-[12px] text-zinc-300 leading-relaxed resize-none focus:outline-none font-mono"
            placeholder="Write your call script here..."
          />
        ) : (
          <div className="text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap space-y-1">
            {renderScript(current.content).split('\n').map((line, i) => (
              <p
                key={i}
                className={`${
                  line === '' ? 'h-3' : ''
                } ${
                  line.startsWith('[') && line.endsWith(']')
                    ? 'text-[#00c896] font-bold text-[10px] uppercase tracking-wider bg-[#00c896]/5 px-2 py-0.5 rounded'
                    : ''
                }`}
              >
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

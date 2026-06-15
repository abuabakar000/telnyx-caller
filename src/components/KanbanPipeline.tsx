'use client';

import React, { useState } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import type { Lead } from './LeadQueue';

interface KanbanPipelineProps {
  leads: Lead[];
  onLeadDrop: (leadId: string, newStatus: string) => void;
  onOpenTimeline: (lead: Lead) => void;
}

const COLUMNS = [
  { key: 'New', label: 'New', color: 'text-zinc-400', dot: 'bg-zinc-500', border: 'border-zinc-800' },
  { key: 'Contacted', label: 'Contacted', color: 'text-blue-400', dot: 'bg-blue-500', border: 'border-blue-900/40' },
  { key: 'Callback', label: 'Callback', color: 'text-amber-400', dot: 'bg-amber-500', border: 'border-amber-900/40' },
  { key: 'Interested', label: 'Interested', color: 'text-[#00c896]', dot: 'bg-[#00c896]', border: 'border-[#00c896]/30' },
  { key: 'Closed', label: 'Closed', color: 'text-zinc-600', dot: 'bg-zinc-700', border: 'border-zinc-900' },
];

const DISP_COLOR: Record<string, string> = {
  'Interested': 'text-[#00c896]',
  'Callback': 'text-amber-400',
  'No Answer': 'text-zinc-500',
  'VM Left': 'text-amber-500',
  'Not Interested': 'text-red-400',
};

export default function KanbanPipeline({ leads, onLeadDrop, onOpenTimeline }: KanbanPipelineProps) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [expandedCol, setExpandedCol] = useState<string | null>('New');

  const getLeadsForStatus = (status: string) =>
    leads.filter(l => l.status === status);

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDragLeadId(leadId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
  };

  const handleDragOver = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colKey);
  };

  const handleDrop = (e: React.DragEvent, colKey: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragLeadId;
    if (id) {
      onLeadDrop(id, colKey);
    }
    setDragOverCol(null);
    setDragLeadId(null);
  };

  const handleDragEnd = () => {
    setDragOverCol(null);
    setDragLeadId(null);
  };

  return (
    <div className="w-full h-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 flex flex-col" style={{ minHeight: '580px' }}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-zinc-900">
        <Layers size={13} className="text-zinc-500" />
        <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400">Pipeline</h2>
        <span className="text-[9px] text-zinc-600 ml-auto font-bold">Drag to move</span>
      </div>

      {/* Kanban Columns - Accordion on tight space */}
      <div className="flex-grow overflow-y-auto space-y-2">
        {COLUMNS.map((col) => {
          const colLeads = getLeadsForStatus(col.key);
          const isOver = dragOverCol === col.key;
          const isExpanded = expandedCol === col.key;

          return (
            <div
              key={col.key}
              onDragOver={(e) => handleDragOver(e, col.key)}
              onDrop={(e) => handleDrop(e, col.key)}
              onDragLeave={() => setDragOverCol(null)}
              className={`rounded-xl border transition-all duration-150 ${
                isOver
                  ? 'border-[#00c896]/50 bg-[#00c896]/5 shadow-[0_0_16px_rgba(0,200,150,0.08)]'
                  : col.border + ' bg-zinc-900/10'
              }`}
            >
              {/* Column Header */}
              <button
                className="w-full flex items-center gap-2.5 p-3 text-left"
                onClick={() => setExpandedCol(isExpanded ? null : col.key)}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${col.dot} shrink-0`} />
                <span className={`text-[10px] font-bold uppercase tracking-wider flex-grow ${col.color}`}>
                  {col.label}
                </span>
                <span className={`text-[9px] font-bold border px-1.5 py-0.5 rounded-full ${
                  colLeads.length > 0 ? col.color : 'text-zinc-700'
                } ${isOver ? 'border-[#00c896]/30' : col.border}`}>
                  {colLeads.length}
                </span>
                <ChevronRight
                  size={11}
                  className={`text-zinc-600 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                />
              </button>

              {/* Lead Cards */}
              {isExpanded && (
                <div
                  className={`pb-2 px-2 space-y-1.5 min-h-[40px] transition-all`}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                >
                  {colLeads.length === 0 ? (
                    <div className={`py-4 text-center text-[9px] font-bold uppercase tracking-wider border-2 border-dashed rounded-lg ${
                      isOver ? 'border-[#00c896]/40 text-[#00c896]' : 'border-zinc-900 text-zinc-700'
                    }`}>
                      {isOver ? '⬇ Drop Here' : 'Empty'}
                    </div>
                  ) : (
                    colLeads.map((lead) => {
                      const fullName = `${lead.firstName} ${lead.lastName}`.trim() || lead.phone;
                      const initials = [lead.firstName[0], lead.lastName[0]].filter(Boolean).join('').toUpperCase() || '#';
                      const isDragging = dragLeadId === lead.id;

                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, lead.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => onOpenTimeline(lead)}
                          className={`flex items-center gap-2 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-900/60 cursor-grab active:cursor-grabbing hover:border-zinc-700 transition-all group ${
                            isDragging ? 'opacity-30' : 'opacity-100'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-full bg-zinc-900 flex items-center justify-center text-[8px] font-bold text-zinc-500 shrink-0">
                            {initials}
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className="text-[10px] font-semibold text-zinc-300 truncate">{fullName}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {lead.company && (
                                <span className="text-[8px] text-zinc-600 truncate">{lead.company}</span>
                              )}
                              {lead.disposition && (
                                <span className={`text-[8px] font-bold ${DISP_COLOR[lead.disposition] || 'text-zinc-600'}`}>
                                  · {lead.disposition}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight size={10} className="text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary Footer */}
      {leads.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-900 grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-[8px] font-bold uppercase tracking-wider text-zinc-600">Total</p>
            <p className="text-xs font-bold text-zinc-300 font-mono">{leads.length}</p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-bold uppercase tracking-wider text-zinc-600">Interested</p>
            <p className="text-xs font-bold text-[#00c896] font-mono">
              {leads.filter(l => l.status === 'Interested').length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[8px] font-bold uppercase tracking-wider text-zinc-600">Closed</p>
            <p className="text-xs font-bold text-zinc-500 font-mono">
              {leads.filter(l => l.status === 'Closed').length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

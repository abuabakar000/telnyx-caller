'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, Check, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { importLeads, LeadData } from '@/app/actions/leads';

interface ExcelImportProps {
  onImportComplete: (count: number) => void;
  onClose: () => void;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  firstName: ['first name', 'firstname', 'first', 'fname', 'given name'],
  lastName: ['last name', 'lastname', 'last', 'lname', 'surname', 'family name'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'telephone', 'tel', 'number'],
  company: ['company', 'organization', 'org', 'business', 'firm', 'employer'],
  email: ['email', 'e-mail', 'mail'],
};

function mapHeader(header: string): string | null {
  const normalized = header.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some(a => normalized.includes(a))) return field;
  }
  return null;
}

export default function ExcelImport({ onImportComplete, onClose }: ExcelImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [parsedLeads, setParsedLeads] = useState<LeadData[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback((file: File) => {
    setParseError(null);
    setParsedLeads([]);
    setImportResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rows.length < 2) {
          setParseError('File appears empty or has no data rows.');
          return;
        }

        const headers = (rows[0] as string[]).map(h => String(h));
        const fieldMap: Record<number, string> = {};
        headers.forEach((h, i) => {
          const mapped = mapHeader(h);
          if (mapped) fieldMap[i] = mapped;
        });

        if (!Object.values(fieldMap).includes('phone')) {
          setParseError('Could not find a "Phone" column. Make sure your sheet has a Phone / Mobile column header.');
          return;
        }

        const leads: LeadData[] = [];
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] as any[];
          const phone = String(row[Object.keys(fieldMap).find(k => fieldMap[Number(k)] === 'phone') as any] || '').trim();
          if (!phone) continue;

          const get = (field: string) => {
            const idx = Object.keys(fieldMap).find(k => fieldMap[Number(k)] === field);
            return idx !== undefined ? String(row[Number(idx)] || '').trim() : '';
          };

          leads.push({
            firstName: get('firstName'),
            lastName: get('lastName'),
            phone,
            company: get('company') || undefined,
            email: get('email') || undefined,
          });
        }

        if (leads.length === 0) {
          setParseError('No valid leads found in the file.');
          return;
        }

        setParsedLeads(leads);
      } catch (err: any) {
        setParseError(`Failed to parse file: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleConfirmImport = async () => {
    if (parsedLeads.length === 0) return;
    setImporting(true);
    const res = await importLeads(parsedLeads);
    setImporting(false);
    if (res.success) {
      setImportResult({ imported: res.importedCount || 0, failed: res.failedCount || 0 });
      onImportComplete(res.importedCount || 0);
    } else {
      setParseError(res.error || 'Import failed.');
    }
  };

  const displayLeads = showAll ? parsedLeads : parsedLeads.slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#00c896]/10 border border-[#00c896]/20">
              <FileSpreadsheet size={16} className="text-[#00c896]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Import Leads</h2>
              <p className="text-[10px] text-zinc-500 mt-0.5">Upload .xlsx file — columns: First Name, Last Name, Phone, Company, Email</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-all">
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          {/* Drop Zone */}
          {parsedLeads.length === 0 && !importResult && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-[#00c896]/60 bg-[#00c896]/5'
                  : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/20'
              }`}
            >
              <Upload size={28} className={isDragging ? 'text-[#00c896]' : 'text-zinc-600'} />
              <div className="text-center">
                <p className="text-sm font-bold text-zinc-300">Drop your .xlsx file here</p>
                <p className="text-[11px] text-zinc-600 mt-1">or click to browse</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileInput} className="hidden" />
            </div>
          )}

          {/* Parse Error */}
          {parseError && (
            <div className="flex items-start gap-2 p-3 bg-red-950/20 border border-red-900/40 rounded-xl text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Preview Table */}
          {parsedLeads.length > 0 && !importResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Preview — {parsedLeads.length} leads from <span className="text-[#00c896]">{fileName}</span>
                </span>
                <button
                  onClick={() => { setParsedLeads([]); setFileName(''); }}
                  className="text-[10px] text-zinc-600 hover:text-red-400 uppercase font-bold"
                >
                  Clear
                </button>
              </div>

              {/* Virtualized-style fixed-height table */}
              <div className="rounded-xl border border-zinc-800 overflow-hidden">
                <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1.5fr_2fr] bg-zinc-900 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  <span>First Name</span>
                  <span>Last Name</span>
                  <span>Phone</span>
                  <span>Company</span>
                  <span>Email</span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                  {displayLeads.map((lead, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1.5fr_2fr] px-3 py-2 text-[11px] text-zinc-300 border-t border-zinc-900/60 hover:bg-zinc-900/30 font-mono"
                    >
                      <span className="truncate pr-2">{lead.firstName || '—'}</span>
                      <span className="truncate pr-2">{lead.lastName || '—'}</span>
                      <span className="truncate pr-2 text-[#00c896]">{lead.phone}</span>
                      <span className="truncate pr-2 text-zinc-500">{lead.company || '—'}</span>
                      <span className="truncate text-zinc-500">{lead.email || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {parsedLeads.length > 8 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 font-bold uppercase"
                >
                  {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showAll ? 'Show less' : `Show all ${parsedLeads.length} leads`}
                </button>
              )}
            </div>
          )}

          {/* Success state */}
          {importResult && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-14 h-14 rounded-full bg-[#00c896]/10 border border-[#00c896]/30 flex items-center justify-center">
                <Check size={24} className="text-[#00c896]" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-zinc-100">Import Complete</p>
                <p className="text-xs text-zinc-500 mt-1">
                  <span className="text-[#00c896] font-bold">{importResult.imported}</span> leads imported
                  {importResult.failed > 0 && <span className="text-red-400 ml-2">({importResult.failed} failed)</span>}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3 p-6 border-t border-zinc-900">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
          >
            {importResult ? 'Close' : 'Cancel'}
          </button>
          {parsedLeads.length > 0 && !importResult && (
            <button
              onClick={handleConfirmImport}
              disabled={importing}
              className="flex-1 py-2.5 bg-[#00c896] text-black hover:bg-[#00b386] disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
            >
              {importing ? `Importing ${parsedLeads.length} leads...` : `Confirm Import (${parsedLeads.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

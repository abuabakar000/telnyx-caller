'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Phone, MessageSquare, PhoneCall, TrendingUp } from 'lucide-react';
import { getDashboardStats } from '@/app/actions/leads';

export default function Navbar() {
  const pathname = usePathname();
  const [stats, setStats] = useState({ totalCalls: 0, connectRate: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await getDashboardStats();
        if (res.success && res.stats) {
          setStats({ totalCalls: res.stats.totalCalls, connectRate: res.stats.connectRate });
        }
      } catch {}
    };
    fetchStats();
    const id = setInterval(fetchStats, 60000);
    return () => clearInterval(id);
  }, []);

  const navItems = [
    { href: '/', label: 'Phone Dialer', icon: Phone },
    { href: '/sms', label: 'SMS Workspace', icon: MessageSquare },
  ];

  return (
    <header className="w-full max-w-[1400px] mx-auto px-2 sm:px-4 pt-2 sm:pt-4 select-none z-20">
      <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-2xl px-3.5 sm:px-6 py-2.5 sm:py-4 flex items-center justify-between gap-2 sm:gap-4">
        {/* Logo / Branding */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <div className="p-1.5 sm:p-2 rounded-xl bg-[#00c896]/10 border border-[#00c896]/20 text-[#00c896]">
            <PhoneCall size={16} className="sm:w-[18px] sm:h-[18px]" />
          </div>
          <span className="text-xs sm:text-sm font-bold tracking-wider sm:tracking-widest text-zinc-100 uppercase">
            Inex Labs
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                  isActive
                    ? 'bg-zinc-900 border border-zinc-800 text-[#00c896] shadow-sm shadow-[#00c896]/5'
                    : 'text-zinc-400 hover:text-zinc-200 border border-transparent hover:bg-zinc-900/50'
                }`}
              >
                <Icon size={13} className="sm:w-[14px] sm:h-[14px]" />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.label === 'Phone Dialer' ? 'Dialer' : 'SMS'}</span>
              </Link>
            );
          })}
        </nav>

        {/* Live Stats Pills + Org Tag */}
        <div className="flex items-center gap-2">
          {stats.totalCalls > 0 && (
            <div className="hidden sm:flex items-center gap-1.5 bg-zinc-900/60 border border-zinc-900 px-3 py-1.5 rounded-xl">
              <Phone size={10} className="text-zinc-600" />
              <span className="text-[10px] font-bold text-zinc-400 font-mono">{stats.totalCalls}</span>
              <span className="text-[9px] text-zinc-600 uppercase font-bold">today</span>
              <span className="text-zinc-700 mx-1">·</span>
              <TrendingUp size={10} className={stats.connectRate >= 20 ? 'text-[#00c896]' : 'text-amber-400'} />
              <span className={`text-[10px] font-bold font-mono ${stats.connectRate >= 20 ? 'text-[#00c896]' : 'text-amber-400'}`}>
                {stats.connectRate}%
              </span>
            </div>
          )}
          <div className="hidden sm:flex items-center">
            <span className="text-[9px] font-bold text-zinc-650 tracking-wider uppercase bg-zinc-900/50 border border-zinc-900 px-2.5 py-1 rounded-lg">
              {process.env.NEXT_PUBLIC_ORG_NAME || 'Inex Labs'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

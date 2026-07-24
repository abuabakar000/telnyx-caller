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
    <header className="w-full max-w-6xl mx-auto px-4 pt-4 select-none z-20">
      <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-2xl px-6 py-4 flex items-center justify-between gap-4">
        {/* Logo / Branding */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#00c896]/10 border border-[#00c896]/20 text-[#00c896]">
            <PhoneCall size={16} />
          </div>
          <span className="text-xs font-bold tracking-widest text-zinc-200 uppercase">
            Inex Labs Suite
          </span>
        </div>

        {/* Navigation Links */}
        <nav className="flex items-center gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                  isActive
                    ? 'bg-zinc-900 border border-zinc-800 text-[#00c896] shadow-sm shadow-[#00c896]/5'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
              >
                <Icon size={13} />
                <span>{item.label}</span>
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

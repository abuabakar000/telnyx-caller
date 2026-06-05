'use client';

import dynamic from 'next/dynamic';
import { PhoneCall } from 'lucide-react';

// Import Dialer dynamically to disable SSR since WebRTC depends on client-only APIs
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

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center justify-center p-2 sm:p-4 relative selection:bg-zinc-800">
      
      {/* Sleek, deep background design */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(24,24,27,0.4)_0%,transparent_100%)] pointer-events-none" />
      
      {/* Dynamic dialer container */}
      <main className="z-10 w-full flex justify-center items-center">
        <Dialer />
      </main>

      {/* Modern minimalist footer */}
      <footer className="absolute bottom-6 text-[10px] tracking-wider text-zinc-600 font-semibold uppercase z-10 select-none">
        Powered by Telnyx Voice API
      </footer>
    </div>
  );
}

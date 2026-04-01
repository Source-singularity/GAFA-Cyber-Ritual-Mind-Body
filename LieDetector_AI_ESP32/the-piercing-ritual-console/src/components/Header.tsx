import React from 'react';
import { Terminal } from 'lucide-react';

export default function Header({ isAborted }: { isAborted: boolean }) {
  return (
    <header className="border-b-2 border-[#1a1a1a] pb-4 flex items-center justify-between z-10">
      <div className="flex items-center gap-4">
        <Terminal className="w-8 h-8 text-white/50" />
        <h1 className="text-2xl md:text-4xl font-bold tracking-tighter uppercase glitch" data-text="RITUAL CONSOLE: Subjectivity Verification">
          RITUAL CONSOLE: <span className="text-white/50">Subjectivity Verification</span>
        </h1>
      </div>
      
      <div className="flex items-center gap-3 border border-[#1a1a1a] px-4 py-2 bg-[#0a0a0a]">
        <div className={`w-3 h-3 rounded-full ${isAborted ? 'bg-gray-600' : 'bg-red-600 animate-pulse'}`}></div>
        <span className="text-xs font-bold tracking-widest uppercase text-white/70">
          {isAborted ? 'SYSTEM OFFLINE' : 'REC_ACTIVE'}
        </span>
      </div>
    </header>
  );
}

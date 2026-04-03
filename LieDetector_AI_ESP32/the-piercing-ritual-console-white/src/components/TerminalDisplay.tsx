import React from 'react';
import { Terminal } from 'lucide-react';
import { motion } from 'motion/react';

export default function TerminalDisplay({ data, isAborted }: any) {
  const displayData = isAborted ? { status: "OFFLINE", error: "SUBJECT_DISCONNECTED" } : {
    bpm: Number(data.bpm).toFixed(1),
    waveform: Number(data.waveform).toFixed(2),
    emotions: data.emotions ? Object.fromEntries(Object.entries(data.emotions).map(([k, v]) => [k, Number(v).toFixed(3)])) : {},
    is_lying: data.is_lying,
    max_emo: data.max_emo?.toUpperCase() || "N/A"
  };

  return (
    <div className="border border-gray-300 bg-white p-4 flex flex-col gap-2 h-full font-mono relative overflow-hidden shadow-sm">
      {/* ★ 插入这一行：点阵将覆盖在这个面板的所有文字和背景之上 */}
      <div className="panel-dot-overlay"></div>
      <div className="flex flex-col gap-1 border-b border-gray-200 pb-2 mb-2">
        <h2 className="text-xs font-bold tracking-widest uppercase text-gray-500 flex items-center gap-2">
          <Terminal className="w-3 h-3" /> INBOUND_METRICS
        </h2>
        <span className={`text-[9px] pl-5 font-bold ${isAborted ? 'text-red-600' : 'text-blue-600 animate-pulse'}`}>
          {isAborted ? 'STATUS: PORT_CLOSED' : 'STATUS: PORT_8765_LISTENING'}
        </span>
      </div>

      {/* 字体改为深灰色 text-gray-800 */}
      <div className="flex-1 text-[11px] leading-loose text-gray-800 whitespace-pre-wrap overflow-hidden font-bold">
        <span className="text-blue-600/70">{">"} SESSION_ID: 0x8F9A2B</span><br/>
        {JSON.stringify(displayData, null, 2)}
        {!isAborted && (
          <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="inline-block w-2 h-3 bg-gray-800 ml-1 align-middle" />
        )}
      </div>
    </div>
  );
}

import React from 'react';
import { Terminal } from 'lucide-react';
import { motion } from 'motion/react';

export default function TerminalDisplay({ data, isAborted }: any) {
  // 清理数据，保留指定小数位，使视觉更整齐
  const displayData = isAborted ? { status: "OFFLINE", error: "SUBJECT_DISCONNECTED" } : {
    bpm: Number(data.bpm).toFixed(1),
    waveform: Number(data.waveform).toFixed(2),
    emotions: data.emotions ? Object.fromEntries(
      Object.entries(data.emotions).map(([k, v]) => [k, Number(v).toFixed(3)])
    ) : {},
    is_lying: data.is_lying,
    max_emo: data.max_emo?.toUpperCase() || "N/A"
  };

  return (
    <div className="border border-[#1a1a1a] bg-[#050505] p-4 flex flex-col gap-2 h-full font-mono relative overflow-hidden">
      {/* 头部区域：改为纵向排列 */}
      <div className="flex flex-col gap-1 border-b border-[#1a1a1a] pb-2 mb-2">
        {/* 第一行：图标 + 标题 */}
        <h2 className="text-xs font-bold tracking-widest uppercase text-white/50 flex items-center gap-2">
          <Terminal className="w-3 h-3" /> 
          INBOUND_METRICS
        </h2>
        
        {/* 第二行：状态标识（添加了 pl-5 让它与文字对齐） */}
        <span className={`text-[9px] pl-5 font-mono ${isAborted ? 'text-red-600' : 'text-green-500 animate-pulse'}`}>
          {isAborted ? 'STATUS: PORT_CLOSED' : 'STATUS: PORT_8765_LISTENING'}
        </span>
      </div>

      {/* 数据内容区域 */}
      <div className="flex-1 text-[11px] leading-loose text-green-500/90 whitespace-pre-wrap overflow-hidden">
        <span className="text-blue-400 opacity-70">{">"} SESSION_ID: 0x8F9A2B</span><br/>
        {JSON.stringify(displayData, null, 2)}
        {!isAborted && (
          <motion.div 
            animate={{ opacity: [0, 1, 0] }} 
            transition={{ duration: 0.8, repeat: Infinity }} 
            className="inline-block w-2 h-3 bg-green-500 ml-1 align-middle" 
          />
        )}
      </div>
    </div>
  );
}
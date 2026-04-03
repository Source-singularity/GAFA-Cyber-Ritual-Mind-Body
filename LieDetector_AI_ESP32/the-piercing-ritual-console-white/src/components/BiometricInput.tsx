import React from 'react';
import { Eye, ScanFace, ShieldAlert, Terminal } from 'lucide-react';
import { motion } from 'motion/react';

export default function BiometricInput({ emotions, isAborted, streamImg, bpm, waveform, isLying, maxEmo }: any) {
  // 构造要显示的原始 JSON 对象
  const rawData = {
    "bpm": bpm.toFixed(1),
    "waveform": waveform.toFixed(2),
    "emotions": Object.fromEntries(
        Object.entries(emotions).map(([k, v]: [string, any]) => [k, v.toFixed(3)])
    ),
    "is_lying": isLying,
    "max_emo": maxEmo.toUpperCase()
  };

  return (
    <div className="border border-[#1a1a1a] bg-[#0a0a0a] p-4 flex flex-col gap-4 h-full relative overflow-hidden font-mono">
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-2">
        <h2 className="text-sm font-bold tracking-widest uppercase text-white/50 flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Diagnostic Feed
        </h2>
        <span className="text-[10px] text-green-500 font-mono animate-pulse">STREAMING_ACTIVE</span>
      </div>

      {/* 视频区域 */}
      <div className="relative aspect-video bg-black border border-[#1a1a1a] overflow-hidden">
        {streamImg ? (
          <img src={streamImg} className="w-full h-full object-cover grayscale opacity-70 contrast-150" alt="Feed" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/10 text-[10px]">RECONNECTING...</div>
        )}
        <div className="absolute inset-0 scanline pointer-events-none"></div>
      </div>

      {/* ★ 核心：终端风格数据监视区 ★ */}
      <div className="flex-1 bg-black/50 border border-[#1a1a1a] p-3 overflow-hidden relative">
        {/* 背景装饰：随机变化的十六进制码 */}
        <div className="absolute inset-0 opacity-[0.03] text-[8px] leading-tight break-all pointer-events-none">
            {Array(500).fill(0).map(() => Math.floor(Math.random()*16).toString(16))}
        </div>

        <div className="relative z-10 text-[11px] leading-relaxed">
          <div className="text-blue-400 mb-1 font-bold italic border-b border-blue-900/30 pb-1">
             {">"} LOCALHOST:8765_INBOUND_METRICS
          </div>
          
          {/* 模拟终端高亮显示 */}
          <div className="text-green-500/90 whitespace-pre-wrap">
            {JSON.stringify(rawData, null, 2)}
          </div>

          {/* 闪烁的光标 */}
          <motion.div 
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="inline-block w-2 h-3 bg-green-500 ml-1 align-middle"
          />
        </div>
      </div>
      
      {/* 底部小状态 */}
      <div className="text-[9px] text-white/20 flex justify-between uppercase">
        <span>Packet Size: 1.2kb</span>
        <span>Latency: 12ms</span>
      </div>
    </div>
  );
}
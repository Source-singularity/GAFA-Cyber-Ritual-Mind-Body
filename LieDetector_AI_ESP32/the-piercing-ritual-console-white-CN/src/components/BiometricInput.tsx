import React from 'react';
import { Terminal } from 'lucide-react';
import { motion } from 'motion/react';

export default function BiometricInput({ emotions, isAborted, streamImg, bpm, waveform, isLying, maxEmo }: any) {
  const rawData = {
    "心率": bpm.toFixed(1),
    "波形": waveform.toFixed(2),
    "情绪概率": Object.fromEntries(
        Object.entries(emotions).map(([k, v]: [string, any]) => [k, v.toFixed(3)])
    ),
    "判定动摇": isLying ? "检测到异常" : "稳定",
    "最高峰值": maxEmo.toUpperCase()
  };

  return (
    <div className="border border-[#1a1a1a] bg-[#0a0a0a] p-4 flex flex-col gap-4 h-full relative overflow-hidden font-mono">
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-2">
        <h2 className="text-sm font-black tracking-widest uppercase text-white/50 flex items-center gap-2">
          <Terminal className="w-4 h-4" /> 临床数据流回放
        </h2>
        <span className="text-[10px] text-green-500 font-mono animate-pulse">STREAMING_ACTIVE</span>
      </div>

      <div className="relative aspect-video bg-black border border-[#1a1a1a] overflow-hidden grayscale">
        {streamImg ? (
          <img src={streamImg} className="w-full h-full object-cover opacity-70 contrast-150" alt="Feed" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/10 text-[10px]">正在同步链路...</div>
        )}
      </div>

      <div className="flex-1 bg-black/50 border border-[#1a1a1a] p-3 overflow-hidden relative">
        <div className="relative z-10 text-[11px] leading-relaxed">
          <div className="text-blue-400 mb-1 font-black italic border-b border-blue-900/30 pb-1">
             {">"} 系统底层原始度量
          </div>
          <div className="text-green-500/90 whitespace-pre-wrap font-bold">
            {JSON.stringify(rawData, null, 2)}
          </div>
          <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.8, repeat: Infinity }} className="inline-block w-2 h-3 bg-green-500 ml-1" />
        </div>
      </div>
    </div>
  );
}
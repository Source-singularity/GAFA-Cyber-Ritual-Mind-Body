import React from 'react';
import { Terminal } from 'lucide-react';
import { motion } from 'motion/react';

export default function TerminalDisplay({ data, isAborted }: any) {
  // 格式化函数：确保数值保留三位小数
  const formatEmotions = (emos: any) => {
    if (!emos) return {};
    return Object.fromEntries(
      Object.entries(emos).map(([k, v]: [string, any]) => [k, Number(v).toFixed(3)])
    );
  };

  const displayData = isAborted ? { 状态: "OFFLINE", 错误: "主体链接断开" } : {
    系统模式: data.status,
    采样进度: `${Math.round(data.sampling_progress)}%`,
    兼容指数: data.support_index ? `${data.support_index.toFixed(3)}%` : "计算中...",
    实时心率: `${Number(data.bpm).toFixed(1)} BPM`,
    // 核心微表情概率（保留3位）
    神经度量: formatEmotions(data.emotions), 
    主导情绪: data.max_emo?.toUpperCase() || "N/A"
  };

  return (
    <div className="border border-gray-300 bg-white p-4 flex flex-col gap-2 h-full font-mono relative overflow-hidden shadow-sm">
      <div className="panel-dot-overlay"></div>
      <div className="flex flex-col gap-1 border-b border-gray-200 pb-2 mb-2">
        <h2 className="text-xs font-black tracking-widest uppercase text-gray-500 flex items-center gap-2">
          <Terminal className="w-3 h-3" /> INBOUND_METRICS
        </h2>
        <span className={`text-[9px] pl-5 font-black ${isAborted ? 'text-red-600' : 'text-blue-600 animate-pulse'}`}>
          {isAborted ? 'STATUS: PORT_CLOSED' : `MODE: ${data.status || 'CONNECTING'}`}
        </span>
      </div>

      {/* 调整滚动条样式使其更像终端 */}
      <div className="flex-1 text-[10px] leading-relaxed text-gray-800 whitespace-pre-wrap overflow-y-auto font-bold scrollbar-hide">
        <span className="text-blue-600/70">{">"} SESSION_ID: 0x8F9A2B</span><br/>
        {JSON.stringify(displayData, null, 2)}
        {!isAborted && (
          <motion.div 
            animate={{ opacity: [0, 1, 0] }} 
            transition={{ duration: 0.8, repeat: Infinity }} 
            className="inline-block w-2 h-3 bg-gray-800 ml-1 align-middle" 
          />
        )}
      </div>
    </div>
  );
}
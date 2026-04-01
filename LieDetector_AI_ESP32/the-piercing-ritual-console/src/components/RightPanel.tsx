import React, { useState, useEffect } from 'react';
import { Activity, HeartPulse } from 'lucide-react';

const EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise'];

export default function RightPanel({ heartRate, spo2, maxEmo, isAborted }: any) {
  // 增加血氧显示的保护逻辑：如果 spo2 不存在或为 0，显示 "--"
  const displaySpo2 = (spo2 && spo2 > 0) ? Number(spo2).toFixed(1) : '--';
  // 增加心率显示的保护逻辑
  const displayBpm = (heartRate && heartRate > 0) ? heartRate : '--';

  return (
    <div className="border border-[#1a1a1a] bg-[#0a0a0a] p-4 flex flex-col gap-6 h-full font-mono">
      
      {/* 1. 心率数字显示 */}
      <div className="flex justify-between items-end border-b border-[#1a1a1a] pb-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Heart Rate</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-6xl font-bold ${heartRate > 0 ? 'text-red-600' : 'text-gray-800'} tracking-tighter transition-colors`}>
                {isAborted ? '--' : displayBpm}
              </span>
              <span className="text-xs text-white/30 font-bold">BPM</span>
            </div>
          </div>
          <HeartPulse className={`w-8 h-8 ${heartRate > 0 ? 'text-red-600 animate-pulse' : 'text-gray-800'}`} />
      </div>

      {/* 2. 血氧数字显示 */}
      <div className="flex justify-between items-end border-b border-[#1a1a1a] pb-4">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Blood Oxygen</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-bold ${spo2 > 0 ? 'text-blue-500' : 'text-gray-800'} tracking-tighter transition-colors`}>
              {isAborted ? '--' : displaySpo2}
            </span>
            <span className="text-xs text-white/30 font-bold">% SpO2</span>
          </div>
        </div>
        <Activity className={`w-6 h-6 ${spo2 > 0 ? 'text-blue-500' : 'text-gray-800'}`} />
      </div>

      {/* 3. 垂直情绪列表 (Neural State Classification) */}
      <div className="flex-1 flex flex-col">
        <span className="text-[10px] font-bold text-white/30 tracking-widest uppercase mb-4">Neural State Classification</span>
        <div className="flex flex-col gap-3">
          {EMO_LABELS.map((emo) => {
            // 匹配逻辑：忽略大小写进行比对
            const isActive = !isAborted && maxEmo && emo.toLowerCase() === maxEmo.toLowerCase();
            
            return (
              <div 
                key={emo} 
                className={`flex items-center gap-3 text-[18px] uppercase tracking-[0.2em] transition-all duration-300 ${
                  isActive ? 'text-white font-bold' : 'text-[#222]'
                }`}
              >
                <span className="w-4 text-center">{isActive ? '>' : ''}</span>
                <span className={isActive ? (emo === 'fear' || emo === 'anger' ? 'text-red-500' : 'text-white') : ''}>
                  {emo}
                </span>
                {isActive && (
                  <div className="ml-auto w-1 h-3 bg-current animate-pulse shadow-[0_0_8px_currentColor]"></div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 装饰性页脚 */}
      <div className="mt-auto pt-4 border-t border-[#1a1a1a] flex justify-between">
          <span className="text-[8px] text-white/10">SIGNAL_STRENGTH: OPTIMAL</span>
          <span className="text-[8px] text-white/10">REF_ID: B-0102</span>
      </div>
    </div>
  );
}
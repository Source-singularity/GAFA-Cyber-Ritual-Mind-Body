import React from 'react';
import { Activity, HeartPulse } from 'lucide-react';

const EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise'];

export default function RightPanel({ heartRate, spo2, maxEmo, isAborted }: any) {
  const displaySpo2 = (spo2 && spo2 > 0) ? Number(spo2).toFixed(1) : '--';
  const displayBpm = (heartRate && heartRate > 0) ? heartRate : '--';

  return (
    <div className="border border-gray-300 bg-white p-4 flex flex-col gap-6 h-full font-mono shadow-sm relative">
      {/* ★ 插入这一行：点阵将覆盖在这个面板的所有文字和背景之上 */}
      <div className="panel-dot-overlay"></div>
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Heart Rate</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-6xl font-black ${heartRate > 0 ? 'text-red-600' : 'text-gray-300'} tracking-tighter transition-colors`}>
                {isAborted ? '--' : displayBpm}
              </span>
              <span className="text-xs text-gray-400 font-bold">BPM</span>
            </div>
          </div>
          <HeartPulse className={`w-8 h-8 ${heartRate > 0 ? 'text-red-600 animate-pulse' : 'text-gray-300'}`} />
      </div>

      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Blood Oxygen</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-black ${spo2 > 0 ? 'text-blue-600' : 'text-gray-300'} tracking-tighter transition-colors`}>
              {isAborted ? '--' : displaySpo2}
            </span>
            <span className="text-xs text-gray-400 font-bold">% SpO2</span>
          </div>
        </div>
        <Activity className={`w-6 h-6 ${spo2 > 0 ? 'text-blue-600' : 'text-gray-300'}`} />
      </div>

      <div className="flex-1 flex flex-col">
        <span className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-4">Neural State Classification</span>
        <div className="flex flex-col gap-3">
          {EMO_LABELS.map((emo) => {
            const isActive = !isAborted && maxEmo && emo.toLowerCase() === maxEmo.toLowerCase();
            return (
              <div key={emo} className={`flex items-center gap-3 text-[16px] uppercase tracking-[0.2em] transition-all duration-300 ${isActive ? 'text-black font-black' : 'text-gray-300 font-medium'}`}>
                <span className="w-4 text-center text-blue-600">{isActive ? '>' : ''}</span>
                <span className={isActive ? (emo === 'fear' || emo === 'anger' ? 'text-red-600' : 'text-black') : ''}>
                  {emo}
                </span>
                {isActive && <div className="ml-auto w-1.5 h-4 bg-black animate-pulse shadow-sm"></div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { Activity, HeartPulse } from 'lucide-react';

// 情绪翻译映射
const EMO_MAP: Record<string, string> = {
  anger: "愤怒", contempt: "蔑视", disgust: "厌恶", fear: "恐惧",
  happiness: "配合/快乐", neutral: "中性/服从", sadness: "动摇/悲伤", surprise: "受激/惊讶"
};

const EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise'];

export default function RightPanel({ heartRate, spo2, maxEmo, isAborted }: any) {
  return (
    <div className="border border-gray-300 bg-white p-4 flex flex-col gap-2 h-full font-mono shadow-sm relative">
      <div className="panel-dot-overlay"></div>
      
      <div className="flex justify-between items-end border-b border-gray-200 pb-4">
          <div className="flex flex-col">
            <span className="text-[15px] font-black text-gray-400 uppercase tracking-widest">实时心率</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-6xl font-black ${heartRate > 0 ? 'text-red-600' : 'text-gray-300'} tracking-tighter transition-colors tabular-nums`}>
                {isAborted ? '--' : (heartRate || '--')}
              </span>
              <span className="text-20 text-gray-400 font-bold">BPM</span>
            </div>
          </div>
          <HeartPulse className={`w-8 h-8 ${heartRate > 0 ? 'text-red-600 animate-pulse' : 'text-gray-300'}`} />
      </div>

      <div className="flex justify-between items-end border-b border-gray-200 pb-5">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">血氧饱和度</span>
          <div className="flex items-baseline gap">
            <span className={`text-4xl font-black ${spo2 > 0 ? 'text-blue-600' : 'text-gray-300'} tracking-tighter tabular-nums`}>
              {isAborted ? '--' : (spo2 > 0 ? Number(spo2).toFixed(1) : '--')}
            </span>
            <span className="text-15 text-gray-400 font-bold">% SpO2</span>
          </div>
        </div>
        <Activity className={`w-6 h-6 ${spo2 > 0 ? 'text-blue-600' : 'text-gray-300'}`} />
      </div>

      <div className="flex-1 flex flex-col gap-">
        <span className="text-[12px] font-black text-gray-400 tracking-widest uppercase mb-4 mt-8">神经状态分类评估</span>
        <div className="flex flex-col gap-5">
          {EMO_LABELS.map((emo) => {
            const isActive = !isAborted && maxEmo && emo.toLowerCase() === maxEmo.toLowerCase();
            return (
              <div key={emo} className={`flex items-center gap-3 text-[30px] transition-all duration-300 ${isActive ? 'text-black font-black' : 'text-gray-300 font-bold'}`}>
                <span className="w-3 text-center text-blue-600">{isActive ? '>' : ''}</span>
                <span className={isActive ? (emo === 'fear' || emo === 'anger' ? 'text-red-600' : 'text-black') : ''}>
                  {EMO_MAP[emo]}
                </span>
                {isActive && <div className="ml-auto w-1.5 h-4 bg-black animate-pulse"></div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
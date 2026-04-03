import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import TerminalDisplay from './components/TerminalDisplay';
import RightPanel from './components/RightPanel';
import ActuatorStatus from './components/ActuatorStatus';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  // --- 1. 核心状态 ---
  const [isAborted, setIsAborted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fullState, setFullState] = useState({ 
    bpm: 0, 
    waveform: 0, 
    spo2: 0, 
    emotions: {}, 
    is_lying: false, 
    max_emo: "neutral", 
    img: "" 
  });
  const [ecgData, setEcgData] = useState<{ time: number; value: number }[]>([]);

  // --- 2. 数据链路 ---
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');
    ws.onmessage = (event) => {
      if (isAborted) return;
      try {
        const data = JSON.parse(event.data);
        setFullState(data);
        setEcgData(prev => {
          const newData = [...prev, { time: Date.now(), value: data.waveform }];
          if (newData.length > 50) newData.shift();
          return newData;
        });
      } catch (err) {
        console.error("Data error");
      }
    };
    return () => ws.close();
  }, [isAborted]);

  // --- 3. 快捷键与缩放 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        if (e.key === '=') { e.preventDefault(); setZoom(prev => Math.min(prev + 0.1, 2)); }
        if (e.key === '-') { e.preventDefault(); setZoom(prev => Math.max(prev - 0.2, 0.5)); }
        if (e.key === '0') { e.preventDefault(); setZoom(1); }
      }
      if (e.key === 'F11' || e.key === 'f') {
        e.preventDefault();
        if ((window as any).pywebview) (window as any).pywebview.api.toggle_fullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAbort = () => setIsAborted(true);

  return (
    <div className="bg-[#e5e7eb] w-screen h-screen overflow-hidden flex items-start justify-start relative">
      
      {/* 核心缩放容器 */}
      <div 
        className={`min-h-screen w-full bg-[#f8fafc] text-gray-900 font-mono p-4 flex flex-col gap-4 relative ${fullState.is_lying && !isAborted ? 'pulse-red-light' : ''}`}
        style={{ 
          transform: `scale(${zoom})`, 
          transformOrigin: 'top left',
          width: `${100 / zoom}%`,
          height: `${100 / zoom}%`,
          transition: 'transform 0.2s ease-out'
        }}
      >
        {/* ★ 1. 全局点阵层：设为 z-10，覆盖大部分 UI */}
        <div className="clinical-dot-overlay z-10"></div>

        <Header isAborted={isAborted} />

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* 左侧终端 */}
          <div className="lg:col-span-2 h-232">
            <TerminalDisplay data={fullState} isAborted={isAborted} />
          </div>

          {/* 中间核心区 */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            
            {/* ★ 2. 视频区域：设为 z-30，穿透点阵层，保证画面干净 */}
            <div className="relative z-30 aspect-video bg-gray-200 border border-gray-300 overflow-hidden shadow-sm">
               {fullState.img ? (
                 <img 
                    src={fullState.img} 
                    className="w-full h-full object-cover opacity-95" 
                    alt="Subspace Feed" 
                 />
               ) : (
                 <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs font-bold uppercase tracking-widest animate-pulse">
                    Establishing Subspace Link...
                </div>
               )}
               {/* 视频内部专用条纹 */}
               <div className="video-scanline"></div>
            </div>
            
            {/* ECG 波形图：设为 z-20，会被 z-10 的点阵盖住文字，产生质感 */}
            <div className="h-32 border border-gray-300 bg-white p-2 relative shadow-sm z-0">
              <span className="absolute top-2 left-2 text-[10px] text-gray-400 uppercase font-bold tracking-widest">
                ECG Trace (Real-time)
              </span>
              {!isAborted && (
                <div className="w-full h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ecgData}>
                      <YAxis domain={[-100, 100]} hide />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#dc2626" 
                        strokeWidth={2} 
                        dot={false} 
                        isAnimationActive={false} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* 电机状态反馈 */}
            <ActuatorStatus 
              bpm={fullState.bpm} 
              emotions={fullState.emotions} 
              isAborted={isAborted} 
              onAbort={handleAbort} 
            />
          </div>

          {/* 右侧面板 */}
          <div className="lg:col-span-2 h-232">
            <RightPanel 
              heartRate={Math.round(fullState.bpm)} 
              spo2={fullState.spo2} 
              maxEmo={fullState.max_emo} 
              isAborted={isAborted} 
            />
          </div>
        </div>

        {/* 紧急中止：设为 z-50 确保在最顶层 */}
        {isAborted && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }}
              className="border-2 border-red-600 bg-white p-10 text-center shadow-[0_0_50px_rgba(220,38,38,0.2)]"
            >
              <ShieldAlert className="w-20 h-20 text-red-600 mx-auto mb-6 animate-pulse" />
              <h1 className="text-5xl font-black text-red-600 mb-4 glitch" data-text="RITUAL TERMINATED">
                RITUAL TERMINATED
              </h1>
              <p className="text-gray-500 tracking-[0.3em] uppercase text-sm font-bold">
                Subjectivity Reclaimed. Hardware Safely Disengaged.
              </p>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
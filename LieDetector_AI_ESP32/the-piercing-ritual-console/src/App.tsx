import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import TerminalDisplay from './components/TerminalDisplay';
import RightPanel from './components/RightPanel';
import ActuatorStatus from './components/ActuatorStatus';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  // --- 1. 核心状态定义 ---
  const [isAborted, setIsAborted] = useState(false);
  const [zoom, setZoom] = useState(1); // 全局缩放比例
  
  // 全量数据中心 (包含来自 Python 的所有生理和 AI 指标)
  const [fullState, setFullState] = useState({ 
    bpm: 0, 
    waveform: 0, 
    spo2: 0,
    emotions: {}, 
    is_lying: false, 
    max_emo: "neutral", 
    img: "" 
  });

  // ECG 波形绘图数据队列
  const [ecgData, setEcgData] = useState<{ time: number; value: number }[]>([]);

  // --- 2. WebSocket 无线数据链路 ---
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');

    ws.onmessage = (event) => {
      if (isAborted) return;
      try {
        const data = JSON.parse(event.data);
        
        // 更新全量状态
        setFullState(data);

        // 实时压入 ECG 波形队列，保持 50 个点的长度
        setEcgData(prev => {
          const newData = [...prev, { time: Date.now(), value: data.waveform }];
          if (newData.length > 50) newData.shift();
          return newData;
        });
      } catch (err) {
        console.error("WebSocket 数据解析失败", err);
      }
    };

    ws.onclose = () => console.log("📡 祭坛连接断开");
    return () => ws.close();
  }, [isAborted]);

  // --- 3. 全局缩放快捷键监听 (Ctrl + / - / 0) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        if (e.key === '=') { e.preventDefault(); setZoom(prev => Math.min(prev + 0.1, 2)); }
        if (e.key === '-') { e.preventDefault(); setZoom(prev => Math.max(prev - 0.2, 0.5)); }
        if (e.key === '0') { e.preventDefault(); setZoom(1); }
      }
    
      // 2. ★ 新增：按 F11 切换全屏 (调用 Python API)
      if (e.key === 'F11') {
        e.preventDefault(); // 阻止浏览器默认全屏动作
        if ((window as any).pywebview) {
          (window as any).pywebview.api.toggle_fullscreen();
        }
      }

    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- 4. 逻辑处理函数 ---
  const handleAbort = () => setIsAborted(true);

  return (
  /* 底层容器：全屏时作为黑色背景座 */
  <div className="bg-black w-screen h-screen overflow-hidden flex items-start justify-start">
    <div 
      className={`min-h-screen w-full bg-[#050505] ...`}
      style={{ 
        transform: `scale(${zoom})`, 
        transformOrigin: 'top left', // 或者 'center center' 看你喜欢
        width: `${100 / zoom}%`,
        height: `${100 / zoom}%`,
        transition: 'transform 0.2s ease-out' // 让缩放变得有动感
      }}
    >
        <div className="scanline"></div>
        
        <Header isAborted={isAborted} />

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 z-10">
        
          {/* 左侧栏：实时数据终端 (JSON 监视器) */}
          <div className="lg:col-span-2">
            <TerminalDisplay data={fullState} isAborted={isAborted} />
          </div>

          {/* 中间栏：核心视觉 (AI 视频 + 实时 ECG 轨迹 + 硬件状态) */}
          <div className="lg:col-span-8 flex flex-col gap-5">
            {/* 视频区域：显示经过 Python 处理的人脸识别流 */}
            <div className="relative aspect-video bg-black border border-[#1a1a1a] overflow-hidden">
               {fullState.img ? (
                 <img src={fullState.img} className="w-full h-full object-cover grayscale opacity-80 contrast-125" alt="AI Feed" />
               ) : (
                 <div className="absolute inset-0 flex items-center justify-center text-white/10 text-xs">WAITING FOR BIOMETRIC LINK...</div>
               )}
               <div className="absolute inset-0 scanline pointer-events-none"></div>
            </div>
            
            {/* ECG Trace：直接响应 ESP32 原始波形点 */}
            <div className="h-32 border border-[#1a1a1a] bg-[#0a0a0a] p-2 relative">
              <span className="absolute top-2 left-2 text-[10px] text-white/30 uppercase z-10 font-bold">ECG Trace (Real-time)</span>
              {!isAborted && (
                <div className="w-full h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ecgData}>
                      <YAxis domain={[-100, 100]} hide />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#ef4444" 
                        strokeWidth={2} 
                        dot={false} 
                        isAnimationActive={false} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* 硬件执行器反馈 (根据 BPM 算出真实物理速度) */}
            <ActuatorStatus 
              bpm={fullState.bpm} 
              emotions={fullState.emotions} 
              isAborted={isAborted} 
              onAbort={handleAbort} 
            />
          </div>

          {/* 右侧栏：生理指标数字与情绪分类词条 */}
          <div className="lg:col-span-2">
            <RightPanel 
              heartRate={Math.round(fullState.bpm)} 
              spo2={fullState.spo2} // ★ 已接入动态血氧
              maxEmo={fullState.max_emo} 
              isAborted={isAborted} 
            />
          </div>
        </div>

        {/* 紧急中止覆盖层 */}
        {isAborted && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="border-2 border-red-600 bg-black p-10 text-center shadow-[0_0_50px_rgba(255,0,0,0.3)]"
            >
              <ShieldAlert className="w-20 h-20 text-red-600 mx-auto mb-6 animate-pulse" />
              <h1 className="text-5xl font-black text-red-600 mb-4 glitch" data-text="RITUAL TERMINATED">
                RITUAL TERMINATED
              </h1>
              <p className="text-white/50 tracking-[0.3em] uppercase text-sm">
                Subjectivity Reclaimed. Hardware Safely Disengaged.
              </p>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
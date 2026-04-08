import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import TerminalDisplay from './components/TerminalDisplay';
import RightPanel from './components/RightPanel';
import ActuatorStatus from './components/ActuatorStatus';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { ShieldAlert, Activity, FileCheck, ScanFace } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  // --- 1. 基础状态 ---
  const [isAborted, setIsAborted] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const [fullState, setFullState] = useState({ 
    status: "CALIBRATING",
    choice: "",
    bpm: 0, waveform: 0, spo2: 0, emotions: {}, 
    max_emo: "neutral", sampling_progress: 0, support_index: 0, pulse_count: 0, img: "" 
  });
  const [ecgData, setEcgData] = useState<{ time: number; value: number }[]>([]);

  // --- 2. WebSocket 数据链路 ---
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8765');
    ws.onmessage = (event) => {
      if (isAborted) return;
      try {
        const data = JSON.parse(event.data);
        setFullState(data);
        // 更新 ECG 波形队列
        setEcgData(prev => {
          const newData = [...prev, { time: Date.now(), value: data.waveform }];
          if (newData.length > 50) newData.shift();
          return newData;
        });
      } catch (err) {
        console.error("Data processing error");
      }
    };
    return () => ws.close();
  }, [isAborted]);

  // --- 3. 全局交互控制 (快捷键与缩放) ---
  useEffect(() => {

    const handleMouseDown = (e: MouseEvent) => {
      // e.button === 1 代表鼠标中键
      if (e.button === 1) {
        e.preventDefault();
        if (window.pywebview && window.pywebview.api) {
          window.pywebview.api.toggle_pause();
        }
      }
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // A. 缩放逻辑：锁定物理视口，防止拉长
      if (e.ctrlKey) {
        if (e.key === '=') { e.preventDefault(); setZoom(prev => Math.min(prev + 0.1, 2.5)); }
        if (e.key === '-') { e.preventDefault(); setZoom(prev => Math.max(prev - 0.1, 0.5)); }
        if (e.key === '0') { e.preventDefault(); setZoom(1); }
      }
      
      // B. 全屏控制
      if (e.key === 'F11' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if ((window as any).pywebview) (window as any).pywebview.api.toggle_fullscreen();
      }

      // C. 仪式状态机控制
      if (!window.pywebview || !window.pywebview.api) return;
      const key = e.key.toLowerCase();
      
      if (key === 'c') window.pywebview.api.calibrate(); 
      if (key === 's') window.pywebview.api.stop_sampling(); 
      if (e.code === 'Space') { e.preventDefault(); window.pywebview.api.trigger_ritual(); }
      
      // 只有在选择模式下，R/B 键才生效
      if (fullState.status === 'CHOOSING') {
          if (key === 'r') window.pywebview.api.make_choice('red');
          if (key === 'b') window.pywebview.api.make_choice('blue');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown); // ✨ 新增监听
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown); // ✨ 清理
    };
  }, [fullState.status]);

  const handleAbort = () => setIsAborted(true);

  return (
    // 外层容器：绝对禁止滚动
    <div className="w-screen h-screen overflow-hidden bg-[#e2e8f0] flex items-start justify-start">
      
      {/* 核心缩放画布：尺寸锁定公式 width: 100/zoom vw */}
      <div 
        className="bg-[#f8fafc] text-gray-900 font-mono p-4 flex flex-col relative shadow-2xl"
        style={{ 
          transform: `scale(${zoom})`, 
          transformOrigin: 'top left', 
          width: `${100 / zoom}vw`,
          height: `${100 / zoom}vh`, 
          transition: 'transform 0.2s ease-out' 
        }}
      >
        {/* 背景点阵纹理 */}
        <div className="clinical-dot-overlay z-10 pointer-events-none"></div>

        <Header isAborted={isAborted} />

        {/* 12列主网格布局 */}
        <div className="flex-1 h-0 grid grid-cols-12 gap-4 mt-2 relative z-20">
          
          {/* 左侧：JSON 诊断终端 */}
          <div className="col-span-2 h-full overflow-hidden flex flex-col">
            <TerminalDisplay data={fullState} isAborted={isAborted} />
          </div>

          {/* 中间：主监控与波形区 */}
          <div className="col-span-8 flex flex-col gap-4 h-full">
            
            {/* 1. 监控视频：强制 16:9，不随容器拉伸 */}
            <div className="relative z-30 w-full aspect-video bg-gray-200 border border-gray-300 overflow-hidden shadow-sm flex-shrink-0">
               {fullState.img ? (
                 <img src={fullState.img} className="w-full h-full object-cover opacity-95" alt="Subspace Feed" />
               ) : (
                 <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-bold animate-pulse uppercase tracking-[0.4em]">
                    Synchronizing Subspace Link...
                </div>
               )}
               <div className="video-scanline"></div>
               
                {/* ✨ 新增：暂停状态遮罩 ✨ */}
                {fullState.is_paused && fullState.status === 'TESTING' && (
                    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center border-4 border-yellow-600/50">
                      <div className="bg-yellow-600 text-white px-8 py-3 font-black text-2xl tracking-[0.4em] shadow-2xl animate-pulse">
                        采样监控已挂起 / SUSPENDED
                      </div>
                    </div>
                )}

               {/* 校准提示遮罩 */}
               {fullState.status === 'CALIBRATING' && fullState.img && (
                  <div className="absolute inset-0 bg-blue-900/10 flex flex-col items-center justify-center backdrop-blur-[2px] z-40">
                    <ScanFace className="w-12 h-12 text-blue-600 mb-4 animate-pulse" />
                    <span className="text-white text-[10px] font-black tracking-[0.3em] bg-black/60 px-4 py-2 border border-blue-500/50">
                      ESTABLISHING BIOLOGICAL BASELINE
                    </span>
                  </div>
               )}
            </div>

            {/* 2. 采样进度条 (仅测试时开启) */}
            {fullState.status === 'TESTING' && (
              <div className="w-full bg-white border border-gray-300 h-8 relative overflow-hidden flex items-center shadow-sm flex-shrink-0">
                <motion.div 
                  className="bg-blue-600 h-full opacity-25"
                  initial={{ width: 0 }} animate={{ width: `${fullState.sampling_progress}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-4">
                  <span className="text-[10px] font-heiti text-blue-800 animate-pulse flex items-center gap-2">
                    <Activity className="w-3 h-3" /> 接受度采样进行中
                  </span>
                  <span className="text-[10px] font-black text-blue-800">{Math.round(fullState.sampling_progress)}%</span>
                </div>
              </div>
            )}

            {/* 3. ECG 实时波形图：占据剩余所有垂直空间 */}
            <div className="flex-1 min-h-[100px] border border-gray-300 bg-white p-2 relative shadow-sm z-0">
              <span className="absolute top-2 left-2 text-[9px] text-gray-400 uppercase font-heiti-bold tracking-widest">追踪波形: 心率曲线_BPM</span>
              <div className="w-full h-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ecgData}>
                        <YAxis domain={[-100, 100]} hide />
                        <Line type="monotone" dataKey="value" stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            {/* 4. 电机状态反馈：固定高度 */}
            <div className="flex-shrink-0">
                <ActuatorStatus bpm={fullState.bpm} emotions={fullState.emotions} isAborted={isAborted} onAbort={handleAbort} />
            </div>
          </div>

          {/* 右侧：情绪指标面板 */}
          <div className="col-span-2 h-full">
            <RightPanel heartRate={Math.round(fullState.bpm)} spo2={fullState.spo2} maxEmo={fullState.max_emo} isAborted={isAborted} />
          </div>
        </div>

        {/* ---[ 状态 2：红蓝选择页 (中文版) ] --- */}
        <AnimatePresence>
          {fullState.status === 'CHOOSING' && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-[#f8fafc]/90 backdrop-blur-sm flex items-center justify-center"
            >
              <div className="clinical-dot-overlay opacity-20"></div>
              <div className="relative z-10 flex flex-col items-center -mt-10 text-black">
                <div className="mb-8 text-center">
                  <h1 className="text-5xl font-black tracking-tighter uppercase font-heiti-bold">仪式已初始化</h1>
                  <p className="text-gray-400 font-bold tracking-[0.4em] text-[11px] uppercase mt-2">协议 ID: 0x7FF-异质链路</p>
                </div>

                <div className="bg-white border-y-[3px] border-black py-10 px-24 mb-16 text-center shadow-sm max-w-[900px]">
                  <h2 className="text-3xl font-bold tracking-tight text-gray-800 leading-relaxed font-heiti-bold">
                    你接受 <span className="text-blue-600 underline underline-offset-8">外来物质</span> 植入用于身体改造吗？
                  </h2>
                  <p className="text-gray-400 text-xs mt-6 font-medium tracking-[0.2em] font-heiti-bold">进行深度神经验证前，必须获得生物学授权。</p>
                </div>
                
                <div className="flex gap-12">
                  <button onClick={() => window.pywebview.api.make_choice('red')} 
                    className="group relative w-80 h-48 border-2 border-red-600 bg-white transition-all hover:bg-red-50 active:scale-95 shadow-lg">
                    <div className="absolute top-3 left-3 text-[9px] font-black text-red-600">序列: 01</div>
                    <span className="text-4xl font-black text-red-600 tracking-tighter">拒绝 [R]</span>
                    <div className="absolute bottom-3 right-3 text-[9px] font-black text-red-600">状态: 拒绝授权</div>
                  </button>

                  <button onClick={() => window.pywebview.api.make_choice('blue')} 
                    className="group relative w-80 h-48 border-2 border-blue-600 bg-white transition-all hover:bg-blue-50 active:scale-95 shadow-lg">
                    <div className="absolute top-3 left-3 text-[9px] font-black text-blue-600">序列: 02</div>
                    <span className="text-4xl font-black text-blue-600 tracking-tighter">接受 [B]</span>
                    <div className="absolute bottom-3 right-3 text-[9px] font-black text-blue-600">状态: 自愿服从</div>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---[ 状态 4：结果报告页 (中文版) ] --- */}
        <AnimatePresence>
          {fullState.status === 'REPORTING' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[120] bg-[#f8fafc]/70 backdrop-blur-xl flex items-center justify-center"
            >
              <div className="max-w-3xl w-full border-[4px] border-black p-14 bg-white shadow-[40px_40px_0px_0px_rgba(0,0,0,0.05)] -mt-10 text-black">
                <div className="flex justify-between items-start border-b-[4px] border-black pb-10 mb-10">
                  <div>
                    <h2 className="text-5xl font-black tracking-tighter font-heiti-bold">主体性验证报告</h2>
                    <p className="text-gray-400 text-xs mt-3 uppercase font-bold tracking-[0.4em]">
                      来源: 祭坛终端_S3_采样节点
                    </p>
                  </div>
                  <FileCheck className="w-20 h-20 text-black" />
                </div>
                
                <div className="flex flex-col gap-12">
                  <div className="flex justify-between items-end">
                    <span className="text-xl font-bold text-gray-400 uppercase tracking-[0.2em]">生物兼容性指数</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[140px] font-black tracking-tighter leading-none font-mono">
                            {fullState.support_index.toFixed(1)}
                        </span>
                        <span className="text-5xl font-black">%</span>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="h-8 bg-gray-100 w-full overflow-hidden border-[3px] border-black">
                      <motion.div 
                        initial={{ width: 0 }} animate={{ width: `${fullState.support_index}%` }} transition={{ duration: 2 }}
                        className={`h-full ${fullState.support_index > 50 ? 'bg-black' : 'bg-red-600'}`} 
                      />
                    </div>
                    <div className="flex justify-between items-center border-t border-gray-100 pt-4">
                        <span className="text-[11px] text-gray-400 font-bold uppercase tracking-widest">口头声明: {fullState.choice === 'blue' ? '接受' : '拒绝'}</span>
                        <p className="text-sm font-black uppercase italic tracking-tighter bg-gray-100 px-3 py-1">
                          {fullState.support_index > 85 ? "系统判定: 完美的受体" : 
                          fullState.support_index > 50 ? "系统判定: 存在潜意识反抗" : 
                          "系统判定: 生物性排斥"}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="mt-16 text-center">
                    <span className="inline-block px-6 py-2 bg-black text-white text-[11px] font-bold tracking-[0.5em] uppercase animate-pulse">
                        8 秒后自动重置终端
                    </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 紧急中止层 */}
        {isAborted && (
          <div className="absolute inset-0 z-[200] flex items-center justify-center bg-white/95 backdrop-blur-md">
            <div className="border-[10px] border-red-600 bg-white p-16 text-center shadow-2xl">
              <ShieldAlert className="w-32 h-32 text-red-600 mx-auto mb-8 animate-pulse" />
              <h1 className="text-7xl font-black text-red-600 tracking-tighter">RITUAL TERMINATED</h1>
              <p className="mt-4 text-gray-500 font-bold tracking-[0.3em] uppercase">Emergency Hardware Disengagement Active</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
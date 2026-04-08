export default function ActuatorStatus({ bpm, emotions, isAborted, onAbort }: any) {
  let cycleTime = 30.0; 
  let spasmFreq = 0.0;

  if (!isAborted) {
    if (bpm < 40 || bpm > 130) {
      cycleTime = 15.0; 
    } else {
      let hrFactor = bpm <= 60 ? 2.0 : bpm < 80 ? 2.0 - ((bpm - 60) * 0.05) : bpm <= 90 ? 1.0 : 1.0 - ((bpm - 90) * 0.018);
      const maxEmo = emotions ? Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b, 'neutral') : 'neutral';
      let emoFactor = maxEmo === 'anger' || maxEmo === 'fear' ? 2.0 : (maxEmo === 'happiness' ? 0.7 : 1.0);
      cycleTime = Math.max(3.8, 6.0 / (hrFactor * emoFactor));
      spasmFreq = bpm / 60.0;
    }
  }

  const motorSpeedHz = isAborted ? "0.00" : (1.0 / cycleTime).toFixed(2);

  return (
    <div className="flex gap-4 items-stretch w-full h-32">
      <div className="flex-1 border border-gray-300 bg-white p-3 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <span className="text-[11px] text-gray-500 font-heiti-bold uppercase tracking-widest border-b border-gray-100 pb-1">
          执行器 A: 穿刺驱动步进
        </span>
        <div className="flex-1 flex items-end justify-between mt-4">
          <span className="text-[10px] text-gray-400 font-black mb-1">实时速率</span>
          <div className="flex items-baseline">
            <span className={`text-4xl font-black tabular-nums ${isAborted ? 'text-gray-300' : 'text-black'}`}>
              {motorSpeedHz}
            </span>
            <span className="text-[10px] text-gray-500 ml-1 font-bold">Hz</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center text-[9px] text-gray-400 font-black">
           <span>目标周期: {isAborted ? '0.0' : cycleTime.toFixed(1)}s</span>
           <span>行程: 100mm</span>
        </div>
      </div>

      <div className="flex-1 border border-gray-300 bg-white p-3 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <span className="text-[11px] text-gray-500 font-heiti-bold uppercase tracking-widest border-b border-gray-100 pb-1">
          执行器 B: 痉挛反馈电磁
        </span>
        <div className="flex-1 flex items-end justify-between mt-4">
          <span className="text-[10px] text-gray-400 font-black mb-1">触发频率</span>
          <div className="flex items-baseline">
            <span className={`text-4xl font-black tabular-nums ${isAborted ? 'text-gray-300' : 'text-orange-600'}`}>
              {isAborted ? '0.00' : spasmFreq.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-500 ml-1 font-bold">Hz</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center text-[9px] text-gray-400 font-black">
           <span>脉宽: 100ms</span>
           <span>状态: 激活</span>
        </div>
      </div>

      <button onClick={onAbort} className="w-20 border-2 border-red-600 bg-red-50 text-red-600 text-xs font-black uppercase hover:bg-red-600 hover:text-white transition-all shadow-sm">
        终止
      </button>
    </div>
  );
}
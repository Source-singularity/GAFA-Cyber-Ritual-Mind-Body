export default function ActuatorStatus({ bpm, emotions, isAborted, onAbort }: any) {
  // ★ 调整：初始值设为 30.0，匹配硬件无人时的“深渊呼吸”模式
  let cycleTime = 30.0; 
  let spasmFreq = 0.0;

  if (!isAborted) {
    // 情况 A：无人，或者心率异常（进入深渊模式）
    if (bpm < 40 || bpm > 130) {
      cycleTime = 15.0; 
      spasmFreq = 0.0; // 无人时电磁铁不跳动
    } 
    // 情况 B：正常交互中
    else {
      let hrFactor = 1.0;
      if (bpm <= 60) hrFactor = 2.0;
      else if (bpm < 80) hrFactor = 2.0 - ((bpm - 60) * (1.0 / 20.0));
      else if (bpm <= 90) hrFactor = 1.0;
      else hrFactor = 1.0 - ((bpm - 90) * (0.75 / 40.0));

      let emoFactor = 1.0;
      const maxEmo = emotions ? Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b, 'neutral') : 'neutral';
      
      if (maxEmo === 'anger' || maxEmo === 'fear') emoFactor = 2.0;
      else if (maxEmo === 'contempt' || maxEmo === 'disgust') emoFactor = 1.5;
      else if (maxEmo === 'happiness' || maxEmo === 'sadness') emoFactor = 0.7;
      else if (maxEmo === 'surprise') emoFactor = 0.5;

      cycleTime = 6.0 / (hrFactor * emoFactor);
      
      // ★ 守住逻辑底线，确保 UI 不会算出超过硬件极限（3.8s）的速度
      if (cycleTime < 3.8) cycleTime = 3.8;
      
      spasmFreq = bpm / 60.0; // 电磁铁频率随心跳
    }
  }

  // 最终显示的 Hz = 1 / 周期时间
  const motorSpeedHz = isAborted ? "0.00" : (1.0 / cycleTime).toFixed(2);

  return (
    /* ★ 调整 1：增加 gap 确保与背景十字的节奏一致，items-stretch 确保高度对齐 */
    <div className="flex gap-5 items-stretch w-full h-35">
      
      {/* Motor A 容器 */}
      <div className="flex-1 border border-gray-300 bg-white p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
        {/* 标题对齐 */}
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest border-b border-gray-100 pb-1">
          Motor A: Piercing Stepper
        </span>
        
        {/* ★ 调整 2：使用 flex-1 撑开中间，确保下方数字位置稳固 */}
        <div className="flex-1 flex items-end justify-between mt-6">
          <span className="text-[10px] text-gray-400 font-bold mb-1">ACTUAL SPEED</span>
          <div className="flex items-baseline">
            {/* 这里的 tabular-nums 属性确保数字宽度固定，不会因为 1 和 7 的宽度不同而抖动 */}
            <span className={`text-4xl font-black tabular-nums ${isAborted ? 'text-gray-300' : 'text-black'}`}>
              {motorSpeedHz}
            </span>
            <span className="text-[10px] text-gray-500 ml-1 font-bold">Hz</span>
          </div>
        </div>

        {/* 底部副信息 */}
        <div className="mt-3 pt-2 border-t border-gray-50 flex justify-between items-center">
           <span className="text-[9px] text-gray-400 font-bold">Target: {isAborted ? '0.0' : cycleTime.toFixed(1)}s</span>
           <span className="text-[9px] text-gray-400 font-bold">Stroke: 100mm</span>
        </div>
      </div>

      {/* Motor B 容器 (同样应用上面的逻辑) */}
      <div className="flex-1 border border-gray-300 bg-white p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest border-b border-gray-100 pb-1">
          Motor B: Spasm Solenoid
        </span>
        <div className="flex-1 flex items-end justify-between mt-6">
          <span className="text-[10px] text-gray-400 font-bold mb-1">TRIGGER FREQ</span>
          <div className="flex items-baseline">
            <span className={`text-4xl font-black tabular-nums ${isAborted ? 'text-gray-300' : 'text-orange-600'}`}>
              {isAborted ? '0.00' : spasmFreq.toFixed(2)}
            </span>
            <span className="text-[10px] text-gray-500 ml-1 font-bold">Hz</span>
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-50 flex justify-between items-center">
           <span className="text-[9px] text-gray-400 font-bold">Width: 100ms</span>
           <span className="text-[9px] text-gray-400 font-bold">Status: ACTIVE</span>
        </div>
      </div>

      {/* Abort 按钮宽度固定，不参与 flex-1 平分 */}
      <button 
        onClick={onAbort} 
        className="w-20 border-2 border-red-600 bg-red-50 text-red-600 text-[11px] font-black uppercase hover:bg-red-600 hover:text-white transition-all shadow-sm active:scale-95"
      >
        Abort
      </button>
    </div>
  );
}

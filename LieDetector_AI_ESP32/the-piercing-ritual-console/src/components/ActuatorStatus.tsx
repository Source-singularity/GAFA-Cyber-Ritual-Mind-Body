import React from 'react';

export default function ActuatorStatus({ bpm, emotions, isAborted, onAbort }: any) {
  // 完美复刻 C++ 硬件逻辑算出来的真实物理参数
  let cycleTime = 6.0;
  let spasmFreq = 0.0;

  if (!isAborted && bpm > 0) {
    if (bpm > 130 || bpm < 40) {
      cycleTime = 30.0; // 深渊模式
    } else {
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
      if (cycleTime < 3.8) cycleTime = 3.8; // 你的物理底线
    }
    // 电磁铁抽动频率 = 心率转换为 Hz
    spasmFreq = bpm / 60.0;
  }

  const motorSpeedHz = isAborted ? 0 : (1.0 / cycleTime).toFixed(2);

  return (
    <div className="flex gap-4">
      {/* 穿刺电机状态 */}
      <div className="flex-1 border border-[#1a1a1a] bg-[#0a0a0a] p-3 flex flex-col justify-between">
        <span className="text-[10px] text-white/40 uppercase tracking-widest">Motor A: Piercing Stepper</span>
        <div className="flex items-end justify-between mt-4">
          <span className="text-[10px] text-white/30">ACTUAL SPEED</span>
          <div className="text-right">
            <span className={`text-3xl font-bold ${isAborted ? 'text-gray-800' : 'text-white'}`}>{motorSpeedHz}</span>
            <span className="text-[10px] text-white/40 ml-1">Hz</span>
          </div>
        </div>
        <div className="mt-2 text-[8px] text-white/20">Target Cycle: {isAborted ? '0.0' : cycleTime.toFixed(1)}s | Stroke: 100mm</div>
      </div>

      {/* 抽动电磁铁状态 */}
      <div className="flex-1 border border-[#1a1a1a] bg-[#0a0a0a] p-3 flex flex-col justify-between">
        <span className="text-[10px] text-white/40 uppercase tracking-widest">Motor B: Spasm Solenoid</span>
        <div className="flex items-end justify-between mt-4">
          <span className="text-[10px] text-white/30">TRIGGER FREQ</span>
          <div className="text-right">
            <span className={`text-3xl font-bold ${isAborted ? 'text-gray-800' : 'text-orange-500'}`}>{isAborted ? '0.0' : spasmFreq.toFixed(1)}</span>
            <span className="text-[10px] text-white/40 ml-1">Hz</span>
          </div>
        </div>
        <div className="mt-2 text-[8px] text-white/20">Pulse Width: 100ms</div>
      </div>

      <button onClick={onAbort} className="w-16 border border-red-900 bg-red-950/20 text-red-500 text-[10px] font-bold uppercase hover:bg-red-900 transition-colors">
        Abort
      </button>
    </div>
  );
}
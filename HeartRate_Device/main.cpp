#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>

HardwareSerial Serial1(PA10, PA9);
MAX30105 sensor;

// 全局变量
long lastBeatTime = 0;
float smoothedIR = 0;
float lastSmoothedIR = 0;
int beatAvg = 75;
float currentBPM = 0;
bool isPulseRising = false; 
bool justDetected = false; // 用于标记这一行是否刚检测到心跳

void setup() {
  pinMode(PC13, OUTPUT);
  Serial1.begin(115200);
  delay(1000);
  
  Wire.begin();
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("MAX30102 NOT FOUND!");
    while (1);
  }

  sensor.setup(0x3F, 8, 2, 100, 411, 4096); 
  Serial1.println("System Ready.");
}

void loop() {
  long rawIR = sensor.getIR();

  if (rawIR < 50000) {
    Serial1.println("No Finger...");
    smoothedIR = 0;
    isPulseRising = false;
    delay(200);
    return;
  }

  if (smoothedIR == 0) smoothedIR = rawIR;

  // 1. 低通滤波
  smoothedIR = (smoothedIR * 0.8) + (rawIR * 0.2); 
  float diff = smoothedIR - lastSmoothedIR;

  // 2. 限幅滤波：防止手抖造成的大波动影响算法
  if (abs(diff) > 800) { 
    isPulseRising = false; 
    lastSmoothedIR = smoothedIR;
    return; 
  }

  // 3. 状态机逻辑：波峰捕捉
  justDetected = false; // 每轮循环重置标记
  if (diff > 15 && isPulseRising == false) {
    isPulseRising = true; 
  }

  if (isPulseRising == true && diff < 0) {
    long delta = millis() - lastBeatTime;
    if (delta > 400) {
      lastBeatTime = millis();
      currentBPM = 60000.0 / delta; 

      if (currentBPM > 40 && currentBPM < 160) {
        beatAvg = (beatAvg * 3 + currentBPM) / 4; 
        digitalToggle(PC13); // 蓝灯闪烁
        justDetected = true; // 标记本行出现了心跳
      }
    }
    isPulseRising = false; 
  }

  // === 4. 格式化输出 (核心修改区) ===

  // A. 同时也输出给 Teleplot 看波形（Teleplot 会识别 > 符号开头的行）
  float plotWave = (diff > 100) ? 100 : ((diff < -100) ? -100 : diff);
  Serial1.print(">Waveform:"); Serial1.println(plotWave);
  Serial1.print(" | BPM: "); Serial1.print(currentBPM, 1);
  // B. 给人眼看的文字输出，全部在一行
  if (justDetected) {
    Serial1.print("[BEAT] "); // 如果检测到心跳，行首加个记号
  } else {
    Serial1.print("       "); // 没检测到时用空格占位，保持对齐
  }

  Serial1.print("IR: "); Serial1.print(rawIR);
  Serial1.print(" | Diff: "); Serial1.print((int)diff);
  Serial1.print(" | BPM: "); Serial1.print(currentBPM, 1);
  Serial1.print(" | Avg: "); Serial1.println(beatAvg);

  // 更新历史值
  lastSmoothedIR = smoothedIR;
  delay(20); 
}
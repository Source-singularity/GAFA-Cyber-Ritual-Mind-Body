#include <Arduino.h>
#include <HardwareSerial.h>

HardwareSerial Serial1(PA9);

void setup()
{
  Serial1.begin(115200);
  pinMode(PC13, OUTPUT);
}

void loop()
{
  Serial1.println("HELLO");
  digitalToggle(PC13);
  delay(1000);
}




#include <Arduino.h>
#include <Wire.h>
#include <MAX30105.h> // 使用 SparkFun MAX3010x 库

// 定义两个 I2C 总线
// I2C1: SCL=PB7, SDA=PB8 (对应 MAX30102)
// I2C2: SCL=PB11, SDA=PB10 (对应 OLED)
TwoWire Wire1(PB8, PB7); 
TwoWire Wire2(PB10, PB11); 

// 1. 定义串口：PA10是RX，PA9是TX
HardwareSerial Serial1(PA10, PA9);


MAX30105 particleSensor;

void setup() {
  Serial.begin(115200);
  
  Wire.begin();          // I2C 初始化
  // 初始化两个 I2C
  Wire1.begin();
  Wire2.begin();


   if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("ERROR: Sensor Not Found!");
    while (1);
  }

  // 初始化传感器，指定使用 Wire1
  else if (!particleSensor.begin(Wire1, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found! Check PB7/PB8 wiring.");
    while (1);
  }
  
  particleSensor.setup();
  Serial.println("System Initialized. Reading IR data...");
}

void loop() {
  // 获取 IR 数值
  long irValue = particleSensor.getIR();


   // 4. 将数值透传给电脑
  // 我们加个前缀"DATA:", 方便后续 Python 解析
  Serial1.print("DATA:");
  Serial1.println(irValue);
  // 简单的判断逻辑：如果 IR 值变动很大，说明有手指按着且有脉动
  if (irValue < 50000) {
    Serial.println("No finger detected.");
  } else {
    Serial.print("IR=");
    Serial.println(irValue);
  }

  delay(50); // 采样间隔
}



#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>

//////////////////////////
// 串口 → PA10 RX, PA9 TX
//////////////////////////

HardwareSerial Serial1(PA10, PA9);

//////////////////////////
// MAX30102
//////////////////////////

MAX30105 sensor;

//////////////////////////

void setup()
{
  pinMode(PC13, OUTPUT);

  Serial1.begin(115200);

  delay(1000);

  Serial1.println("BOOT");

  ////////////////////////
  // I2C1 默认 PB6 PB7
  ////////////////////////

  Wire.begin();

  Serial1.println("I2C start");

  if (!sensor.begin(Wire))
  {
    Serial1.println("MAX30102 NOT FOUND");

    while (1)
    {
      digitalToggle(PC13);
      delay(200);
    }
  }

  Serial1.println("MAX30102 OK");

  sensor.setup();

  Serial1.println("SETUP DONE");
}

void loop()
{
  long ir = sensor.getIR();

  Serial1.print("IR:");
  Serial1.println(ir);

  digitalToggle(PC13);

  delay(50);
}





#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>
#include <heartRate.h> // 确保引入了算法库

long irValue = 0;
long lastBeat = 0; // 上次心跳时间
float beatsPerMinute;

//////////////////////////
// 串口 → PA10 RX, PA9 TX
//////////////////////////

HardwareSerial Serial1(PA10, PA9);

//////////////////////////
// MAX30102
//////////////////////////

MAX30105 sensor;

//////////////////////////

void setup()
{
  pinMode(PC13, OUTPUT);

  Serial1.begin(115200);

  delay(1000);

  Serial1.println("BOOT");

  ////////////////////////
  // I2C1 默认 PB6 PB7
  ////////////////////////

  Wire.begin();

  Serial1.println("I2C start");

  if (!sensor.begin(Wire))
  {
    Serial1.println("MAX30102 NOT FOUND");

    while (1)
    {
      digitalToggle(PC13);
      delay(200);
    }
  }

  Serial1.println("MAX30102 OK");

  sensor.setup();
   // 红色 LED 亮度：从 0x00 到 0xFF (0-50mA)
   // 建议设置为 0x1F (约 10mA) 或 0x3F (约 15mA)
   sensor.setPulseAmplitudeRed(0x3F); 
   // 红外 LED 亮度：这是你目前读取的主要波长
   // 建议设置为 0x3F，这样即使手指按得轻，也能穿透皮下组织
   sensor.setPulseAmplitudeIR(0x3F); 
  
   // 采样率：如果你觉得输出慢，是因为采样率太低
   // MAX30102 的采样率决定了它的响应速度
   // 100Hz 是最稳的，如果你追求“丝滑”，可以试 400Hz
   sensor.setSampleRate(300);

  Serial1.println("SETUP DONE");


}


// 在 loop 外定义
float bpm_history[5] = {0}; 
int bpm_index = 0;

void loop() {
  irValue = sensor.getIR();

  // 检查是否有心跳脉冲 (算法库自带的 checkForBeat)
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();

    beatsPerMinute = 60 / (delta / 1000.0);

    // 只有当心率在 30-200 之间时才打印（过滤噪声）
    if (beatsPerMinute < 2000 && beatsPerMinute > 0) {
      bpm_history[bpm_index] = beatsPerMinute;
      bpm_index = (bpm_index + 1) % 5;
    
      float avg_bpm = 0;
      for(int i=0; i<5; i++) avg_bpm += bpm_history[i];
      avg_bpm /= 5;
    
      Serial1.print("Avg BPM: ");
      Serial1.println(avg_bpm);
    } 
  }

  if (irValue < 5000) {
    Serial1.println("Finger NOT detected!");
  }

  delay(0);
}


#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>
#include "spo2_algorithm.h"

HardwareSerial Serial1(PA10, PA9);

MAX30105 sensor;

uint32_t irBuffer[100];
uint32_t redBuffer[100];

int32_t spo2;
int32_t heartRate;
int8_t validSPO2;
int8_t validHeartRate;

void setup()
{
  Serial1.begin(115200);

  Wire.begin();

  if (!sensor.begin(Wire))
  {
    Serial1.println("Sensor fail");
    while (1);
  }

  sensor.setup();

  Serial1.println("Sensor OK");
}

void loop()
{
  for (int i = 0; i < 100; i++)
  {
    while (!sensor.available());

    redBuffer[i] = sensor.getRed();
    irBuffer[i] = sensor.getIR();

    sensor.nextSample();
  }

  maxim_heart_rate_and_oxygen_saturation(
    irBuffer,
    100,
    redBuffer,
    &spo2,
    &validSPO2,
    &heartRate,
    &validHeartRate
  );

  Serial1.print("HR:");
  Serial1.print(heartRate);

  Serial1.print(" SPO2:");
  Serial1.println(spo2);
}




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
bool isPulseRising = false; // 状态机：标记波形是否正在上升

void setup() {
  pinMode(PC13, OUTPUT);
  Serial1.begin(115200);
  delay(1000);
  
  Wire.begin();
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("MAX30102 NOT FOUND! Check wiring.");
    while (1);
  }

  // 传感器配置：0x1F(红光/红外亮度), 8(采样平均数), 2(红/红外模式), 100(采样率), 411(脉宽), 4096(ADC量程)
  sensor.setup(0x3F, 8, 2, 100, 411, 4096); 
  Serial1.println("System Ready. Place your finger.");
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

  // 1. 低通滤波 (过滤高频噪声)
  smoothedIR = (smoothedIR * 0.8) + (rawIR * 0.2); 
  
  // 2. 核心斜率 (Derivative)
  float diff = smoothedIR - lastSmoothedIR;

  // 3. 状态机：波峰捕捉与防重入机制 (关键！)
  
  // 如果斜率大涨 (比如 > 15)，说明波形开始上升了，进入“充电”状态
  if (diff > 15 && isPulseRising == false) {
    isPulseRising = true; 
  }

  // 如果状态在上升，且斜率开始变成负数 (说明波形越过了最高点，开始下降了！)
  if (isPulseRising == true && diff < 0) {
    
    // 此时确认：这是一个完整的脉搏波峰！
    long delta = millis() - lastBeatTime;
    
    // 防爆破：距离上次有效波峰必须大于 400ms (限制最高 150BPM)
    if (delta > 400) {
      lastBeatTime = millis();
      float bpm = 60000.0 / delta; 

      if (bpm > 0 && bpm < 10060) {
        beatAvg = (beatAvg * 3 + bpm) / 4; 
        
        digitalToggle(PC13); // 闪灯（绝对不会连发了）
        
        // 打印平滑后的红外波形
        Serial1.print(">IR:");
        Serial1.println(smoothedIR);

        // 你甚至可以同时画出心率的变化曲线
        Serial1.print(">BPM:");
        Serial1.println(beatAvg);
        Serial1.print("PEAK DETECTED! | BPM: ");
        Serial1.print(bpm, 1);
        Serial1.print(" | Avg BPM: ");
        Serial1.println(beatAvg);
      }
    }
    
    // 波峰结束，重置状态，等待下一次爬坡
    isPulseRising = false; 
  }

  lastSmoothedIR = smoothedIR;
  delay(20); // 20ms 延时正好对应 50Hz 采样，对付心率足够且能省资源
}




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
bool isPulseRising = false; // 状态机：标记波形是否正在上升

void setup() {
  pinMode(PC13, OUTPUT);
  Serial1.begin(115200);
  delay(1000);
  
  Wire.begin();
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("MAX30102 NOT FOUND! Check wiring.");
    while (1);
  }

  // 传感器配置：0x1F(红光/红外亮度), 8(采样平均数), 2(红/红外模式), 100(采样率), 411(脉宽), 4096(ADC量程)
  sensor.setup(0x3F, 8, 2, 100, 411, 4096); 
  Serial1.println("System Ready. Place your finger.");
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
  
  // 在 loop() 中修改捕捉逻辑
float diff = smoothedIR - lastSmoothedIR;

// 1. 【限幅滤波】如果斜率大的离谱（比如大于 800），说明是手在乱动，直接重置
if (abs(diff) > 800) { 
    isPulseRising = false; 
    // Serial1.println(">Status:Movement_Noise"); // 可以在 Teleplot 标记噪音状态
    lastSmoothedIR = smoothedIR;
    return; // 结束这一轮循环，不进行后续心跳判断
}

// 2. 正常的波峰捕捉（增加一个上限阈值）
if (diff > 15 && diff < 300 && isPulseRising == false) {
    isPulseRising = true; 
}

// 3. 只有在合理的波动范围内才触发
if (isPulseRising == true && diff < 0) {
    // ... 原有的 BPM 计算逻辑 ...
}

// 在画波形时，限制输出在 -200 到 +200 之间
float plotWave = diff;
if (plotWave > 60) plotWave = 60;
if (plotWave < -60) plotWave = -60;

Serial1.print(">Waveform:");
Serial1.println(plotWave);

  // 3. 状态机逻辑（只用来检测心跳并计算 BPM）
  if (diff > 15 && isPulseRising == false) {
    isPulseRising = true; 
  }

  if (isPulseRising == true && diff < 0) {
    long delta = millis() - lastBeatTime;
    if (delta > 400) {
      lastBeatTime = millis();
      float bpm = 60000.0 / delta; 

      if (bpm > 40 && bpm < 160) {
        beatAvg = (beatAvg * 3 + bpm) / 4; 
        
        digitalToggle(PC13); // 蓝灯闪烁

        // 在波形图旁边显示当前的心率数值
        Serial1.print(">BPM:");
        Serial1.println(beatAvg);
        Serial1.print("PEAK DETECTED! | BPM: ");
        Serial1.print(bpm, 1);
        Serial1.print(" | Avg BPM: ");
        
        // 这一行保留用于串口助手看数字，Teleplot 会忽略它
        // Serial1.print("BPM: "); Serial1.println(beatAvg);
      }
    }
    isPulseRising = false; 
  }

  lastSmoothedIR = smoothedIR;
  delay(20); // 采样率控制在 50Hz，波形会很平滑
}




ding


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
  float plotWave = (diff > 60) ? 60 : ((diff < -60) ? -60 : diff);
  Serial1.print(">Waveform:"); Serial1.println(plotWave);

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
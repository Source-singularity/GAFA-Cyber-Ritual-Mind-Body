#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>

HardwareSerial Serial1(PA10, PA9);
MAX30105 sensor;

// ================= 电磁铁电机引脚定义 =================
#define SOLENOID_PIN PA1  // 电磁铁引脚
// ================= 电磁铁电机变量 =================
unsigned long solenoidOffTime = 0; // 记录电磁铁应该关闭的时间

// ================= 步进电机引脚定义 =================
#define PUL_PIN PB12  // 脉冲引脚 (接 TB6600 PUL-)
#define DIR_PIN PB13  // 方向引脚 (接 TB6600 DIR-)
#define EN_PIN  PB14  // 使能引脚 (接 TB6600 EN-) 可选

// ================= 心率传感器全局变量 =================
long lastBeatTime = 0;
float smoothedIR = 0, lastSmoothedIR = 0;
int beatAvg = 75;
float currentBPM = 0;
bool isPulseRising = false; 

// ================= 串口通信与情绪状态 =================
String serialBuffer = "";
String currentEmotion = "neutral";

// ================= 电机控制与状态机 =================
enum SystemState {
  STATE_IDLE,         // 待机/重新采样
  STATE_MOVING_UP,    // 上行运动中
  STATE_MOVING_DOWN   // 下行归位中
};
SystemState sysState = STATE_IDLE;

const long STEPS_PER_TRIP = 10000; // 单程脉冲数 (10cm = 12.5圈 * 800细分)
volatile long stepsRemaining = 0;
volatile bool motionComplete = false;
int targetCycles = 0;      // 锁定需要执行的周期数
float currentCycleTime = 6.0; // 当前决定执行的一个周期耗时

HardwareTimer *stepperTimer;

// ================= 浮点数映射函数 =================
float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// ================= 定时器中断函数 (后台发脉冲) =================
void stepperISR() {
  static bool pulseState = false;
  if (stepsRemaining > 0) {
    pulseState = !pulseState;
    digitalWrite(PUL_PIN, pulseState);
    if (!pulseState) {
      stepsRemaining--; // 完成一个完整的高低电平脉冲
    }
  } else {
    stepperTimer->pause();
    motionComplete = true; // 通知主循环单程走完了
  }
}

// ================= 串口读取函数 =================
void processSerial() {
  while (Serial1.available() > 0) {
    char c = Serial1.read();
    if (c == '<') {
      serialBuffer = "";
    } else if (c == '>') {
      if (serialBuffer.startsWith("EMO:")) {
        currentEmotion = serialBuffer.substring(4);
        currentEmotion.trim(); // 移除可能的换行符
      }
    } else {
      serialBuffer += c;
    }
  }
}

// ================= 核心决策引擎 =================
void calculateMotionParameters() {
  // 1. 极端异常判断 (最高优先级)
  if (currentBPM > 130 || currentBPM < 40) {
    currentCycleTime = 30.0;
    targetCycles = 1;
    return;
  }

  // 2. 心率变速因子计算
  float hr_factor = 1.0;
  if (currentBPM >= 40 && currentBPM <= 60) hr_factor = 2.0;
  else if (currentBPM > 60 && currentBPM < 80) hr_factor = mapFloat(currentBPM, 60, 80, 2.0, 1.0);
  else if (currentBPM >= 80 && currentBPM <= 90) hr_factor = 1.0;
  else if (currentBPM > 90 && currentBPM <= 130) hr_factor = mapFloat(currentBPM, 90, 130, 1.0, 0.25);

  // 3. 情绪变速因子计算
  float emo_factor = 1.0;
  int cycles = 1;
  if (currentEmotion == "anger" || currentEmotion == "fear") { emo_factor = 2.0; cycles = 2; }
  else if (currentEmotion == "contempt" || currentEmotion == "disgust") { emo_factor = 1.5; cycles = 1; }
  else if (currentEmotion == "neutral") { emo_factor = 1.0; cycles = 1; }
  else if (currentEmotion == "happiness" || currentEmotion == "sadness") { emo_factor = 0.7; cycles = 1; }
  else if (currentEmotion == "surprise" || currentEmotion == "surpris") { emo_factor = 0.5; cycles = 2; }

  // 4. 融合计算时间
  currentCycleTime = 6.0 / (hr_factor * emo_factor);

  // 5. 机械安全硬限速 (不得低于 2.5 秒)
  if (currentCycleTime < 2.5) {
    currentCycleTime = 2.5;
  }
  targetCycles = cycles;
}

// ================= 启动单程运动 =================
void startTrip(bool isUp) {
  digitalWrite(DIR_PIN, isUp ? HIGH : LOW);
  stepsRemaining = STEPS_PER_TRIP;
  motionComplete = false;

  // 计算定时器翻转频率
  // 20,000脉冲 = 1个周期。单程10,000脉冲占用时间 = currentCycleTime / 2。
  // Hz = 脉冲数 / 时间。因为 ISR 是状态翻转(开一次关一次算1个脉冲)，所以中断频率需乘 2
  float tripTime = currentCycleTime / 2.0;
  float toggleFreq = (STEPS_PER_TRIP / tripTime) * 2.0; 

  stepperTimer->setOverflow(toggleFreq, HERTZ_FORMAT);
  stepperTimer->resume(); // 启动定时器，后台发脉冲
}


void setup() {
  pinMode(PC13, OUTPUT);
  // 初始化电磁铁引脚
  pinMode(SOLENOID_PIN , OUTPUT);
  digitalWrite(SOLENOID_PIN, LOW);

  // 初始化步进电机引脚
  pinMode(PUL_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW); // 开启使能
  digitalWrite(PUL_PIN, LOW);

  Serial1.begin(115200);
  delay(1000);
  
  Wire.begin();
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("MAX30102 NOT FOUND!");
    while (1);
  }
  sensor.setup(0x3F, 8, 2, 100, 411, 4096); 

  // 初始化硬件定时器 (例如使用 TIM2)
  stepperTimer = new HardwareTimer(TIM2);
  stepperTimer->attachInterrupt(stepperISR);

  Serial1.println("System Ready. Stepper & Sensor Initialized.");
}

void loop() {
  // === 1. 非阻塞解析来自 PC 的情绪指令 ===
  processSerial();

  // === 2. 非阻塞读取心率传感器 ===
  long rawIR = sensor.getIR();
  bool validFinger = (rawIR > 50000);
  float plotWave = 0; // 默认无手指时波形为一条直线(0)
  
  if (validFinger) {
    if (smoothedIR == 0) smoothedIR = rawIR;
    smoothedIR = (smoothedIR * 0.8) + (rawIR * 0.2); 
    float diff = smoothedIR - lastSmoothedIR;

    if (abs(diff) <= 800) { 
      if (diff > 15 && !isPulseRising) isPulseRising = true; 
      if (isPulseRising && diff < 0) {
        long delta = millis() - lastBeatTime;
        if (delta > 400) {
          lastBeatTime = millis();
          currentBPM = 60000.0 / delta; 
          if (currentBPM > 40 && currentBPM < 160) {
            beatAvg = (beatAvg * 3 + currentBPM) / 4; 
            digitalToggle(PC13);

            // ==========================================
            // ★ 新增：在此处激活电磁铁 (电磁铁弹出)
            // ==========================================
            digitalWrite(SOLENOID_PIN, HIGH); 
            solenoidOffTime = millis() + 100; // 100毫秒后自动关闭，这个时间可以调
            // ==========================================
          }
        }
        isPulseRising = false; 
      }
    }
    // 计算有效波形
    plotWave = (diff > 100) ? 100 : ((diff < -100) ? -100 : diff);
    lastSmoothedIR = smoothedIR;
  } else {
    // 没放手指时，重置传感器历史状态，但不清零 currentBPM，以便电机继续运行
    smoothedIR = 0;
    isPulseRising = false;
  }

  // ★ 调整1：将串口发送移出 if(validFinger)，保证不管有没有手指，都持续向PC发送心跳包，维持监听和波形UI
  Serial1.print(">Waveform:"); Serial1.println(plotWave);
  Serial1.print(" | BPM: "); Serial1.print(currentBPM, 1);
  Serial1.print(" | EMO: "); Serial1.println(currentEmotion); 

  // === 3. 非阻塞状态机：控制步进电机运转逻辑 ===
  switch (sysState) {
    case STATE_IDLE:
      // ★ 调整2：去掉 validFinger 限制。只要之前成功测出过心率(currentBPM > 0)，
      // 哪怕临时拿开手指，电机也会按照最后一次记录的 BPM 和 情绪 持续进行基础循环运动。
      if (currentBPM > 0) {
        calculateMotionParameters(); // 锁定当前周期的速度和重复次数
        startTrip(true);             // 开启上行
        sysState = STATE_MOVING_UP;
      }
      break;

    case STATE_MOVING_UP:
      if (motionComplete) {
        startTrip(false);            // 上行完毕，开启下行(归位)
        sysState = STATE_MOVING_DOWN;
      }
      break;

    case STATE_MOVING_DOWN:
      if (motionComplete) {
        targetCycles--;              // 周期完成，扣减剩余次数
        if (targetCycles > 0) {
          startTrip(true);           // 还有周期没跑完，保持同速开启下一次上行
          sysState = STATE_MOVING_UP;
        } else {
          sysState = STATE_IDLE;     // 全部周期跑完，回到 IDLE 重新采样决策
        }
      }
      break;
  }
  // === 4. 电磁铁控制逻辑（自动关闭） ===
  if (millis() > solenoidOffTime) {
    digitalWrite(SOLENOID_PIN, LOW); // 到时间自动收回
  }
  // 小延时防止占满 I2C 通道
  delay(10); 
}
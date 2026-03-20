/*
 * ============================================================
 *  心率 × 情绪 → 步进电机运动控制系统
 *  硬件：STM32F103 + MAX30102 心率传感器 + TB6600 步进驱动器 + 电磁铁
 *
 *  工作原理：
 *    1. MAX30102 实时采集心率 (BPM)
 *    2. PC 通过串口发送情绪标签 (如 anger / neutral / surprise 等)
 *    3. 根据 BPM 和情绪，计算步进电机的运动速度和重复次数
 *    4. 每次检测到心跳，触发电磁铁弹出 100ms (模拟心跳触感)
 *    5. 电机持续上行/下行往复，无需手指一直放在传感器上
 *
 *  串口格式：
 *    STM32 → PC：<W:波形值,B:BPM值,E:情绪>      例：<W:45.2,B:72.0,E:neutral>
 *    PC → STM32：<EMO:情绪标签>                   例：<EMO:anger>
 * ============================================================
 */

#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>
#include <MAX30105.h>

// ============================================================
//  硬件实例
// ============================================================

// 使用 PA10(RX) / PA9(TX) 作为串口1，连接 PC
HardwareSerial Serial1(PA10, PA9);

// MAX30102 心率传感器实例
MAX30105 sensor;


// ============================================================
//  引脚定义
// ============================================================

// 电磁铁
#define SOLENOID_PIN  PA1   // 电磁铁控制引脚，HIGH=弹出，LOW=收回

// 步进电机 (接 TB6600 驱动器)
#define PUL_PIN  PB12       // 脉冲信号 → TB6600 PUL-
#define DIR_PIN  PB13       // 方向信号 → TB6600 DIR-
#define EN_PIN   PB14       // 使能信号 → TB6600 EN-（LOW=使能）

// STM32 板载 LED（用于心跳指示，每次检测到心跳翻转一次）
// PC13 已在 setup() 中设为 OUTPUT，此处无需 #define


// ============================================================
//  常量定义
// ============================================================

// 步进电机单程脉冲数
// 计算：行程 10cm，丝杆导程 8mm/圈，需 10cm/0.8cm = 12.5 圈
// TB6600 细分设为 800 步/圈，则单程 = 12.5 × 800 = 10000 脉冲
const long STEPS_PER_TRIP = 10000;

// STM32F103 定时器时钟频率 (72 MHz)
// 用于将"目标频率(Hz)"换算成 ARR 寄存器值
const uint32_t TIMER_CLOCK_HZ = 72000000;

// 电机最短单周期时间 (秒)，防止频率过高导致 ISR 来不及执行
// 对应最高 toggleFreq = (10000 / 2.0) * 2 = 10000 Hz，安全边际充足
const float MIN_CYCLE_TIME = 2.5;

// 电机最长单周期时间 (秒)，用于无人/异常心率时的默认慢速运动
const float MAX_CYCLE_TIME = 30.0;

// 电磁铁单次弹出持续时间 (毫秒)
const unsigned long SOLENOID_PULSE_MS = 100;


// ============================================================
//  全局变量 —— 电磁铁
// ============================================================

// 记录电磁铁应该自动关闭的时间戳 (millis)
// 上电初始为 0，第一帧 millis() > 0 会执行一次 LOW，无害
unsigned long solenoidOffTime = 0;


// ============================================================
//  全局变量 —— 心率传感器
// ============================================================

long  lastBeatTime    = 0;      // 上次检测到心跳的时间戳 (ms)
float smoothedIR      = 0;      // IR 信号的指数平滑值（用于滤波）
int beatAvg = 75;               // BPM 平均值，初始为 75，后续根据实际测得的 BPM 更新
float lastSmoothedIR  = 0;      // 上一帧的平滑 IR 值（用于计算差分）
float currentBPM      = 0;      // 当前心率 (次/分钟)，0 表示尚未测得
bool  isPulseRising   = false;  // 标记当前是否处于脉搏上升沿阶段


// ============================================================
//  全局变量 —— 串口通信 & 情绪状态
// ============================================================

String serialBuffer  = "";        // 串口接收缓冲区（逐字符拼接）
String currentEmotion = "neutral"; // 当前情绪标签，默认 neutral


// ============================================================
//  全局变量 —— 步进电机 & 状态机
// ============================================================

// 状态机的三个状态
enum SystemState {
  STATE_IDLE,        // 空闲：等待心率数据，或一个完整动作周期结束后重新决策
  STATE_MOVING_UP,   // 上行中：电机正在向上运动
  STATE_MOVING_DOWN  // 下行中：电机正在向下归位
};
SystemState sysState = STATE_IDLE;  // 初始状态为空闲

// ISR 与主循环之间共享的变量，必须声明为 volatile（防止编译器优化掉）
volatile long stepsRemaining = 0;    // 当前单程还剩多少脉冲未发出
volatile bool motionComplete = false; // ISR 通知主循环：单程已走完
volatile bool pulseState     = false; // 当前脉冲引脚的电平状态（true=高，false=低）

int   targetCycles    = 0;    // 当前决策锁定的往复次数（1 或 2）
float currentCycleTime = 6.0; // 当前决策锁定的单周期时长（秒），上下各占一半

// 记录上一次决策时是否处于"无人/默认慢速"模式
// 用于在每次下行结束时判断模式是否切换，若切换则立即重新决策
bool wasDefaultMode = true;

// 硬件定时器指针（使用 TIM2）
HardwareTimer *stepperTimer;


// ============================================================
//  工具函数：浮点数线性映射
//  将 x 从 [in_min, in_max] 线性映射到 [out_min, out_max]
//  等价于 Arduino 内置 map()，但支持浮点数
// ============================================================
float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}


// ============================================================
//  定时器中断服务函数 (ISR)
//  每次定时器溢出时自动调用，负责在后台持续发送脉冲给 TB6600
//
//  原理：每次 ISR 翻转一次 PUL 引脚电平
//        高→低→高→低... 每两次翻转 = 一个完整脉冲
//        TB6600 在上升沿或下降沿计步（取决于接线），此处在下降沿计数
//
//  注意：ISR 内禁止使用 digitalWrite（太慢），直接操作 GPIOB 寄存器
//        BSRR 寄存器写入对应位 → 置高
//        BRR  寄存器写入对应位 → 拉低
// ============================================================
void stepperISR() {
  if (stepsRemaining > 0) {
    // 翻转脉冲状态
    pulseState = !pulseState;

    if (pulseState) {
      GPIOB->BSRR = GPIO_PIN_12;  // PB12 置高（上升沿）
    } else {
      GPIOB->BRR = GPIO_PIN_12;   // PB12 拉低（下降沿）
      stepsRemaining--;            // 下降沿完成，计为一个完整脉冲
    }
  } else if (!motionComplete) {
    // 脉冲发完，停止定时器，通知主循环
    // !motionComplete 防止重复触发（定时器停止前可能还有一次中断挂起）
    stepperTimer->pause();
    motionComplete = true;
  }
}


// ============================================================
//  串口解析函数
//  非阻塞地读取串口缓冲区，解析来自 PC 的情绪指令
//  指令格式：<EMO:情绪标签>  例：<EMO:anger>
//  < 表示帧开始，> 表示帧结束
// ============================================================
void processSerial() {
  while (Serial1.available() > 0) {
    char c = Serial1.read();
    if (c == '<') {
      serialBuffer = "";                          // 遇到 < 清空缓冲，开始新帧
    } else if (c == '>') {
      if (serialBuffer.startsWith("EMO:")) {      // 帧结束，判断是否为情绪指令
        currentEmotion = serialBuffer.substring(4); // 提取情绪标签
        currentEmotion.trim();                    // 去除可能的空白/换行符
      }
    } else {
      serialBuffer += c;                          // 普通字符，追加到缓冲
    }
  }
}


// ============================================================
//  核心决策引擎
//  根据当前 BPM 和情绪，计算并锁定本次动作的速度和重复次数
//  结果写入全局变量 currentCycleTime 和 targetCycles
//
//  设计逻辑：
//    - BPM 决定基础速度因子 hr_factor（BPM 越高越快）
//    - 情绪决定叠加速度因子 emo_factor（激烈情绪更快）
//    - 最终周期时长 = 6.0 / (hr_factor × emo_factor)
//    - 硬限速：单周期不得低于 MIN_CYCLE_TIME 秒（防止频率过高卡死）
// ============================================================
void calculateMotionParameters() {

  // —— 情况1：心率极高（>130 BPM），渐变过渡到最慢速，避免突变 ——
  if (currentBPM > 130) {
    float hr_factor = mapFloat(currentBPM, 130, 160, 0.25, 0.1);
    if (hr_factor < 0.1) hr_factor = 0.1;          // 底限保护
    currentCycleTime = 6.0 / hr_factor;
    if (currentCycleTime > MAX_CYCLE_TIME) currentCycleTime = MAX_CYCLE_TIME;
    targetCycles = 1;
    return;
  }

  // —— 情况2：心率极低/无人（<40 BPM），执行默认慢速待机运动 ——
  if (currentBPM < 40) {
    currentCycleTime = MAX_CYCLE_TIME;  // 30 秒一个完整周期，非常缓慢
    targetCycles = 1;
    return;
  }

  // —— 情况3：正常心率范围（40~130 BPM），计算 hr_factor ——
  // hr_factor 越大 → cycleTime 越小 → 电机越快
  float hr_factor = 1.0;
  if (currentBPM >= 40 && currentBPM <= 60) {
    hr_factor = 2.0;                                          // 低心率：慢速（因子大=cycleTime小=快？）
  } else if (currentBPM > 60 && currentBPM < 80) {
    hr_factor = mapFloat(currentBPM, 60, 80, 2.0, 1.0);      // 60~80：线性从快到标准
  } else if (currentBPM >= 80 && currentBPM <= 90) {
    hr_factor = 1.0;                                          // 80~90：标准速度
  } else if (currentBPM > 90 && currentBPM <= 130) {
    hr_factor = mapFloat(currentBPM, 90, 130, 1.0, 0.25);    // 90~130：线性从标准到快
  }

  // —— 情绪因子 & 重复次数 ——
  // emo_factor 越大 → cycleTime 越小 → 电机越快
  // cycles：某些情绪需要连续执行两个往复周期再重新采样
  float emo_factor = 1.0;
  int   cycles     = 1;

  if      (currentEmotion == "anger"    || currentEmotion == "fear")    { emo_factor = 2.0; cycles = 2; }
  else if (currentEmotion == "contempt" || currentEmotion == "disgust") { emo_factor = 1.5; cycles = 1; }
  else if (currentEmotion == "neutral")                                  { emo_factor = 1.0; cycles = 1; }
  else if (currentEmotion == "happiness"|| currentEmotion == "sadness") { emo_factor = 0.7; cycles = 1; }
  else if (currentEmotion == "surprise" || currentEmotion == "surpris") { emo_factor = 0.5; cycles = 2; }

  // —— 融合计算最终周期时长 ——
  currentCycleTime = 6.0 / (hr_factor * emo_factor);

  // —— 机械安全限速：单周期不得低于 MIN_CYCLE_TIME 秒 ——
  // 防止 toggleFreq 过高导致 ISR 来不及执行而卡死
  if (currentCycleTime < MIN_CYCLE_TIME) {
    currentCycleTime = MIN_CYCLE_TIME;
  }

  targetCycles = cycles;
}


// ============================================================
//  启动单程运动
//  isUp = true  → 上行（DIR 高电平）
//  isUp = false → 下行（DIR 低电平）
//
//  关键步骤顺序（顺序不能乱！）：
//    1. pause()           先停定时器，确保 setOverflow 时定时器不在运行
//    2. delayMicroseconds 给 TB6600 的 DIR 信号足够的建立时间（≥5μs）
//    3. 切换 DIR 方向
//    4. 原子操作重置所有状态变量
//    5. 直接写 ARR 寄存器设置频率（绕开 HardwareTimer 避免误触发中断）
//    6. resume() 启动定时器
// ============================================================
void startTrip(bool isUp) {
  // 步骤1：先停定时器，不依赖 ISR 里的 pause()
  stepperTimer->pause();

  // 步骤2：等待 TB6600 确认最后一个脉冲，并为 DIR 切换提供建立时间
  delayMicroseconds(10);

  // 步骤3：切换方向
  digitalWrite(DIR_PIN, isUp ? HIGH : LOW);

  // 步骤4：原子操作，防止 ISR 在重置过程中介入
  noInterrupts();
  stepsRemaining = STEPS_PER_TRIP;  // 重置脉冲计数
  motionComplete = false;            // 清除完成标志
  pulseState     = false;            // 脉冲状态从 LOW 开始，保证第一个脉冲是完整的上升沿
  digitalWrite(PUL_PIN, LOW);        // 引脚电平与 pulseState 同步
  interrupts();

  // 步骤5：计算目标频率，直接写 TIM2 寄存器
  // 单程时间 = currentCycleTime / 2（上行或下行各占一半周期）
  // 每个完整脉冲需要两次 ISR 翻转（高+低），所以中断频率 = 脉冲数 / 单程时间 × 2
  float tripTime   = currentCycleTime / 2.0;
  float toggleFreq = (STEPS_PER_TRIP / tripTime) * 2.0;

  // 安全限幅（理论范围约 667Hz ~ 100kHz）
  if (toggleFreq > 100000) toggleFreq = 100000;
  if (toggleFreq < 1)      toggleFreq = 1;

  // 直接写 ARR 寄存器：ARR = (定时器时钟 / 目标频率) - 1
  // 不使用 setOverflow()，避免其内部触发更新事件导致 ISR 误触发
  // 不使用 TIM2->EGR = UG，避免更新事件唤醒已挂起的中断
  // TIM2->CNT = 0 只归零计数器，不产生任何事件
  TIM2->ARR = (uint32_t)(TIMER_CLOCK_HZ / toggleFreq) - 1;
  TIM2->CNT = 0;

  // 步骤6：启动定时器，ISR 开始在后台发脉冲
  stepperTimer->resume();
}


// ============================================================
//  初始化
// ============================================================
void setup() {
  // 板载 LED（心跳指示）
  pinMode(PC13, OUTPUT);

  // 电磁铁
  pinMode(SOLENOID_PIN, OUTPUT);
  digitalWrite(SOLENOID_PIN, LOW);  // 上电默认收回

  // 步进电机引脚
  pinMode(PUL_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(EN_PIN,  OUTPUT);
  digitalWrite(EN_PIN,  LOW);  // LOW = 使能驱动器
  digitalWrite(PUL_PIN, LOW);  // 脉冲引脚默认低电平

  // 串口（115200 波特率）
  Serial1.begin(115200);
  delay(1000);  // 等待串口稳定

  // 初始化 MAX30102
  Wire.begin();
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial1.println("MAX30102 NOT FOUND!");
    while (1);  // 传感器未找到，死循环报错
  }
  // 参数：LED亮度=0x3F, 采样平均=8, LED模式=2(红+红外), 采样率=100Hz, 脉宽=411us, ADC量程=4096
  sensor.setup(0x3F, 8, 2, 100, 411, 4096);

  // 初始化硬件定时器 TIM2，绑定 ISR
  stepperTimer = new HardwareTimer(TIM2);
  stepperTimer->attachInterrupt(stepperISR);
  // 注意：此时不 resume()，等到第一次 startTrip() 才启动

  Serial1.println("System Ready.");
}


// ============================================================
//  主循环
//  完全非阻塞设计（除 delayMicroseconds(10) 外无任何阻塞操作）
//  每次 loop 约 10ms（delay(10) 决定），足够响应心率和串口事件
// ============================================================
void loop() {

  // ── 1. 解析来自 PC 的情绪指令 ──────────────────────────────
  processSerial();


  // ── 2. 读取心率传感器 ──────────────────────────────────────
  long rawIR      = sensor.getIR();
  bool validFinger = (rawIR > 50000);  // IR 值 > 50000 认为有手指放置
  float plotWave  = 0;                 // 发送给 PC 的波形值，无手指时为 0

  if (validFinger) {
    // 指数平滑滤波：新值权重 0.2，历史权重 0.8，平滑噪声同时保留趋势
    if (smoothedIR == 0) smoothedIR = rawIR;  // 首次初始化，避免从 0 爬升
    smoothedIR = smoothedIR * 0.8 + rawIR * 0.2;

    float diff = smoothedIR - lastSmoothedIR;  // 差分：正值=上升，负值=下降

    // 忽略幅度过大的跳变（通常是手指抖动噪声）
    if (abs(diff) <= 800) {
      // 检测上升沿：差分 > 15 且之前不在上升阶段
      if (diff > 15 && !isPulseRising) {
        isPulseRising = true;
      }
      // 检测峰值过后的下降沿：确认为一次完整心跳
      if (isPulseRising && diff < 0) {
        long delta = millis() - lastBeatTime;
        if (delta > 400) {  // 400ms 防抖，对应最高 150 BPM
          lastBeatTime = millis();
          currentBPM = 60000.0 / delta;  // 由两次心跳间隔换算为 BPM

          if (currentBPM > 40 && currentBPM < 160) {
            // 加权平均平滑 BPM，防止单次异常跳变影响控制
            beatAvg = (beatAvg * 3 + currentBPM) / 4;

            // 板载 LED 翻转，直观显示心跳
            digitalToggle(PC13);

            // 触发电磁铁弹出（模拟心跳触感）
            digitalWrite(SOLENOID_PIN, HIGH);
            solenoidOffTime = millis() + SOLENOID_PULSE_MS;
          }
        }
        isPulseRising = false;  // 本次心跳处理完毕，等待下一次上升沿
      }
    }

    // 将差分值限幅后作为波形数据发送给 PC（用于 UI 显示）
    plotWave = constrain(diff, -100, 100);
    lastSmoothedIR = smoothedIR;

  } else {
    // 手指离开：重置传感器状态，但保留 currentBPM
    // 保留 BPM 的目的：电机可以继续按最后一次测量值运动，不会突然停下
    smoothedIR    = 0;
    isPulseRising = false;
  }

  // 向 PC 发送实时数据（无论有无手指都发送，维持 PC 端 UI 刷新）
  // 格式：<W:波形,B:BPM,E:情绪>
  Serial1.print("<W:");
  Serial1.print(plotWave, 1);
  Serial1.print(",B:");
  Serial1.print(currentBPM, 1);
  Serial1.println(">");



  // ── 3. 步进电机状态机 ──────────────────────────────────────
  switch (sysState) {

    case STATE_IDLE:
      // 只要曾经测到过心率（currentBPM > 0），就开始运动
      // 即使手指临时离开，也按最后一次 BPM 继续运行
      if (currentBPM > 0) {
        calculateMotionParameters();  // 决策：锁定速度和重复次数
        startTrip(true);              // 开始上行
        sysState = STATE_MOVING_UP;
      }
      break;

    case STATE_MOVING_UP:
      // ISR 在后台倒计数，走完后置 motionComplete = true
      if (motionComplete) {
        startTrip(false);             // 上行完毕，开始下行归位
        sysState = STATE_MOVING_DOWN;
      }
      break;

    case STATE_MOVING_DOWN: {
      if (motionComplete) {
        targetCycles--;               // 本次完整往复完成，剩余次数减一

        // 检查模式是否切换（BPM 从 <40 变为 >=40，或反向）
        bool isDefaultMode = (currentBPM < 40);

        if (targetCycles > 0 && isDefaultMode == wasDefaultMode) {
          // 还有剩余周期，且模式未切换：继续同速上行
          startTrip(true);
          sysState = STATE_MOVING_UP;
        } else {
          // 周期跑完，或模式切换：回到 IDLE 重新决策
          wasDefaultMode = isDefaultMode;
          sysState = STATE_IDLE;
        }
      }
      break;
    }
  }


  // ── 4. 电磁铁自动收回 ──────────────────────────────────────
  // 非阻塞：每帧检查是否到达关闭时间
  if (solenoidOffTime > 0 && millis() > solenoidOffTime) {
    digitalWrite(SOLENOID_PIN, LOW);
    solenoidOffTime = 0;  // 清零，避免重复触发
  }


  // ── 5. 循环节拍控制 ────────────────────────────────────────
  // 10ms 延时：防止 I2C 总线被占满，同时控制串口发送频率
  // 对电机控制无影响（电机由定时器 ISR 在后台独立驱动）
  delay(10);
}

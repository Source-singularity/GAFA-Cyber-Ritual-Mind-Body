#include <Arduino.h>
#include <Wire.h>
#include <MAX30105.h>
#include <WiFi.h>      // ★ 新增：WiFi 库
#include <WiFiUdp.h>   // ★ 新增：UDP 库

MAX30105 sensor;

// ================= Wi-Fi 与 UDP 设置 =================
const char* AP_SSID = "Cyber-Ritual";   // 祭坛发出的 Wi-Fi 名字
const char* AP_PASS = "12345678";       // Wi-Fi 密码 (必须大于8位)
const int UDP_PORT  = 8888;             // 通信端口

WiFiUDP udp;
IPAddress broadcastIp(192, 168, 4, 255); // 默认子网的广播地址，发给所有连上的电脑
char packetBuffer[255];                  // 接收数据缓冲


// ================= 引脚定义 (针对 ESP32-S3) =================
#define SOLENOID_PIN  4   // 电磁铁触发
#define PUL_PIN       5   // 脉冲
#define DIR_PIN       6   // 方向
#define EN_PIN        7   // 使能
#define I2C_SDA_PIN   8   // MAX30102 SDA
#define I2C_SCL_PIN   9   // MAX30102 SCL

#define LED_PIN       2   // ESP32S3 某些板子自带的蓝色LED(不一定有, 兼容处理)

// ================= 常量与系统参数 =================
const long STEPS_PER_TRIP = 10000;
const float MIN_CYCLE_TIME = 2.5;
const float MAX_CYCLE_TIME = 20.0;
const unsigned long SOLENOID_PULSE_MS = 100;

// 根据你驱动器规格填这个值，单位 µs
// 保守起见先填 150，再根据实测往下调
const uint64_t MIN_ALARM_US = 85.0;


unsigned long solenoidOffTime = 0;
long  lastBeatTime    = 0;
float smoothedIR      = 0;
int   beatAvg         = 75;
float lastSmoothedIR  = 0;
float currentBPM      = 0;
bool  isPulseRising   = false;

String serialBuffer  = "";
String currentEmotion = "neutral";

enum SystemState { STATE_IDLE, STATE_MOVING_UP, STATE_MOVING_DOWN };
SystemState sysState = STATE_IDLE;

volatile long stepsRemaining = 0;
volatile bool motionComplete = false;
volatile bool pulseState     = false;

int   targetCycles    = 0;
float currentCycleTime = 6.0;
bool  wasDefaultMode   = true;

// ESP32 硬件定时器句柄
hw_timer_t *stepperTimer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// ================= 工具函数 =================
float mapFloat(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

// ================= ESP32 硬件定时器 ISR (必须放在 IRAM 内存中运行极快) =================
void IRAM_ATTR stepperISR() {
  portENTER_CRITICAL_ISR(&timerMux);
  if (stepsRemaining > 0) {
    pulseState = !pulseState;
    digitalWrite(PUL_PIN, pulseState);
    if (!pulseState) {
      stepsRemaining--;
    }
  } else if (!motionComplete) {
    timerAlarmDisable(stepperTimer); // 停用定时器警报
    motionComplete = true;
  }
  portEXIT_CRITICAL_ISR(&timerMux);
}

// ================= UDP 解析 =================
void processUDP() {
  int packetSize = udp.parsePacket();
  if (packetSize) {
    int len = udp.read(packetBuffer, 255);
    if (len > 0) packetBuffer[len] = '\0';
    String msg = String(packetBuffer);
    
    // 解析指令 <EMO:anger>
    if (msg.startsWith("<EMO:") && msg.endsWith(">")) {
      currentEmotion = msg.substring(5, msg.length() - 1);
      currentEmotion.trim();
    }
  }
}

// ================= 核心决策引擎 =================
void calculateMotionParameters() {
  if (currentBPM > 130) {
    float hr_factor = mapFloat(currentBPM, 130, 160, 0.25, 0.1);
    if (hr_factor < 0.1) hr_factor = 0.1;
    currentCycleTime = 6.0 / hr_factor;
    if (currentCycleTime > MAX_CYCLE_TIME) currentCycleTime = MAX_CYCLE_TIME;
    targetCycles = 1;
    return;
  }
  if (currentBPM < 40) {
    currentCycleTime = MAX_CYCLE_TIME;
    targetCycles = 1;
    return;
  }

  float hr_factor = 1.0;
  if (currentBPM >= 40 && currentBPM <= 60) {
    hr_factor = 2.0;
  } else if (currentBPM > 60 && currentBPM < 80) {
    hr_factor = mapFloat(currentBPM, 60, 80, 2.0, 1.0);
  } else if (currentBPM >= 80 && currentBPM <= 90) {
    hr_factor = 1.0;
  } else if (currentBPM > 90 && currentBPM <= 130) {
    hr_factor = mapFloat(currentBPM, 90, 130, 1.0, 0.25);
  }

  float emo_factor = 1.0;
  int   cycles     = 1;
  if      (currentEmotion == "anger"    || currentEmotion == "fear")    { emo_factor = 2.0; cycles = 2; }
  else if (currentEmotion == "contempt" || currentEmotion == "disgust") { emo_factor = 1.5; cycles = 1; }
  else if (currentEmotion == "neutral")                                 { emo_factor = 1.0; cycles = 1; }
  else if (currentEmotion == "happiness"|| currentEmotion == "sadness") { emo_factor = 0.7; cycles = 1; }
  else if (currentEmotion == "surprise" || currentEmotion == "surpris") { emo_factor = 0.5; cycles = 2; }

  currentCycleTime = 6.0 / (hr_factor * emo_factor);
  if (currentCycleTime < MIN_CYCLE_TIME) {
    currentCycleTime = MIN_CYCLE_TIME;
  }
  targetCycles = cycles;
}

// ================= 启动单程运动 =================
void startTrip(bool isUp) {
  // 停止定时器中断
  timerAlarmDisable(stepperTimer);
  delayMicroseconds(10);
  
  digitalWrite(DIR_PIN, isUp ? HIGH : LOW);

  portENTER_CRITICAL(&timerMux);
  stepsRemaining = STEPS_PER_TRIP;
  motionComplete = false;
  pulseState     = false;
  digitalWrite(PUL_PIN, LOW);
  portEXIT_CRITICAL(&timerMux);

  // 计算 ESP32 警报值
  float tripTime   = currentCycleTime / 2.0;
  float toggleFreq = (STEPS_PER_TRIP / tripTime) * 2.0;
  if (toggleFreq > 100000) toggleFreq = 100000;
  if (toggleFreq < 1)      toggleFreq = 1;

  // ESP32 定时器基准配置为 1MHz (1us/tick)
  // Alarm 触发周期 (微秒) = 1,000,000 / toggleFreq
  uint64_t alarmValue = (uint64_t)(1000000.0 / toggleFreq);
  if (alarmValue < MIN_ALARM_US) alarmValue = MIN_ALARM_US;  // ← 加这一行
  
  timerAlarmWrite(stepperTimer, alarmValue, true);
  timerAlarmEnable(stepperTimer);
}

// ================= 初始化 =================
void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(SOLENOID_PIN, OUTPUT);
  digitalWrite(SOLENOID_PIN, LOW);

  pinMode(PUL_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(EN_PIN,  OUTPUT);
  digitalWrite(EN_PIN,  LOW);
  digitalWrite(PUL_PIN, LOW);

  // ESP32 直接通过 USB 通信
  Serial.begin(115200);
  
  // ★ 开启 Wi-Fi 热点
  Serial.println("Starting Wi-Fi AP...");
  WiFi.softAP(AP_SSID, AP_PASS);
  IPAddress IP = WiFi.softAPIP();
  Serial.print("AP IP address: ");
  Serial.println(IP); // 默认应该是 192.168.4.1

  // 开启 UDP 监听
  udp.begin(UDP_PORT);
  delay(1000);

  // 指定 I2C 引脚
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 NOT FOUND!");
    while (1);
  }
  sensor.setup(0x3F, 8, 2, 100, 411, 4096);

  // 初始化 ESP32 定时器：Timer0, 预分频80 (80MHz/80 = 1MHz), 向上计数
  stepperTimer = timerBegin(0, 80, true);
  timerAttachInterrupt(stepperTimer, &stepperISR, true);

  Serial.println("System Ready - ESP32-S3 Version.");
}

// ================= 主循环 =================
void loop() {
  processUDP();

  long rawIR      = sensor.getIR();
  bool validFinger = (rawIR > 50000);
  float plotWave  = 0;

  if (validFinger) {
    if (smoothedIR == 0) smoothedIR = rawIR;
    smoothedIR = smoothedIR * 0.8 + rawIR * 0.2;

    float diff = smoothedIR - lastSmoothedIR;
    if (abs(diff) <= 800) {
      if (diff > 15 && !isPulseRising) {
        isPulseRising = true;
      }
      if (isPulseRising && diff < 0) {
        long delta = millis() - lastBeatTime;
        if (delta > 400) {
          lastBeatTime = millis();
          currentBPM = 60000.0 / delta;

          if (currentBPM > 40 && currentBPM < 160) {
            beatAvg = (beatAvg * 3 + currentBPM) / 4;
            
            // LED 翻转 (ESP32 没有 digitalToggle 宏，用原生写法)
            digitalWrite(LED_PIN, !digitalRead(LED_PIN));

            digitalWrite(SOLENOID_PIN, HIGH);
            solenoidOffTime = millis() + SOLENOID_PULSE_MS;
          }
        }
        isPulseRising = false;
      }
    }
    plotWave = constrain(diff, -100, 100);
    lastSmoothedIR = smoothedIR;

  } else {
    smoothedIR    = 0;
    isPulseRising = false;
    currentBPM    = 0; 
  }

// 组装并发送 UDP 数据包给上位机
static unsigned long lastUdpSend = 0;
if (millis() - lastUdpSend > 50) {
  udp.beginPacket(broadcastIp, UDP_PORT);
  udp.print("<W:"); udp.print(plotWave, 1);
  udp.print(",B:"); udp.print(currentBPM, 1);
  udp.print(",E:"); udp.print(currentEmotion); // 把情绪也发回去，方便调试
  udp.print(">");
  udp.endPacket();

  // (保留一句 Serial 打印，方便你插着线查 Bug 时看日志)
  Serial.printf("<W:%.1f,B:%.1f,E:%s>\n", plotWave, currentBPM, currentEmotion.c_str());

  lastUdpSend = millis();
}

  switch (sysState) {
    case STATE_IDLE:
      calculateMotionParameters();
      startTrip(true);
      sysState = STATE_MOVING_UP;
      break;

    case STATE_MOVING_UP:
      if (motionComplete) {
        startTrip(false);
        sysState = STATE_MOVING_DOWN;
      }
      break;

    case STATE_MOVING_DOWN: {
      if (motionComplete) {
        targetCycles--;
        bool isDefaultMode = (currentBPM < 40);
        if (targetCycles > 0 && isDefaultMode == wasDefaultMode) {
          startTrip(true);
          sysState = STATE_MOVING_UP;
        } else {
          wasDefaultMode = isDefaultMode;
          sysState = STATE_IDLE;
        }
      }
      break;
    }
  }

  if (solenoidOffTime > 0 && millis() > solenoidOffTime) {
    digitalWrite(SOLENOID_PIN, LOW);
    solenoidOffTime = 0;
  }

  delay(10);
}

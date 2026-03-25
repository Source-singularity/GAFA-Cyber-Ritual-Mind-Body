import os
import cv2
import torch
import socket  # ★ 替换 serial 为 socket
import threading
import time
import numpy as np
from collections import deque

# --- 1. 基础环境配置 (删除所有冗余补丁) ---
os.environ["QT_QPA_PLATFORM"] = "xcb"  # 消除 Wayland 警告
device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")

# --- 2. 加载 HSEmotion 模型 (5080 专用加载逻辑) ---
MODEL_PATH = os.path.expanduser(".hsemotion/enet_b2_8.pt")
try:
    # 直接原生加载，不依赖任何第三方 AI 库
    checkpoint = torch.load(MODEL_PATH, map_location=device, weights_only=False)
    model = checkpoint if isinstance(checkpoint, torch.nn.Module) else checkpoint.get('model', checkpoint)
    model.to(device).eval()
    print(f"✅ 5080 已锁定模型: {MODEL_PATH}")
except Exception as e:
    print(f"❌ 加载失败: {e}")
    exit()

# === 新增 UDP 无线配置 ===
UDP_IP = "0.0.0.0"       # 监听本机所有网卡
UDP_PORT = 8888          # 端口号
ESP_IP = "192.168.4.1"   # ESP32 开启热点后的固定 IP

# 创建全局 UDP Socket
udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_socket.bind((UDP_IP, UDP_PORT))
udp_socket.settimeout(0.5) # 防止线程卡死


# 标签定义
EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']
# 使用 OpenCV 自带的检测器，最稳且不占显存
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# --- 3. 数据缓冲区 (设置显示 2 秒) ---
WAVE_LEN = 100  # 50Hz * 2秒 = 100个点
waveform_queue = deque([0]*WAVE_LEN, maxlen=WAVE_LEN)
current_bpm = 0.0

# --- 4. 串口解析线程 (精简版) ---
active_serial = None # 用于存储当前活跃的串口对象

def udp_worker():
    global current_bpm
    print("📡 正在监听来自祭坛(ESP32)的心跳波形...")
    while True:
        try:
            data, addr = udp_socket.recvfrom(1024)
            line = data.decode('utf-8', errors='ignore').strip()
            if not line: continue
            
            # 解析格式：<W:45.2,B:72.0,E:neutral>
            if line.startswith("<W:") and line.endswith(">"):
                content = line[1:-1]
                parts = content.split(',')
                for part in parts:
                    if part.startswith("W:"):
                        try:
                            val = float(part[2:])
                            waveform_queue.append(val)
                        except: pass
                    elif part.startswith("B:"):
                        try:
                            current_bpm = float(part[2:])
                        except: pass
        except socket.timeout:
            continue # 超时没收到数据，继续监听
        except Exception as e:
            time.sleep(0.1)

# 启动无线接收线程
threading.Thread(target=udp_worker, daemon=True).start()

# --- 5. 波形绘制函数 (2秒缩放) ---
def draw_waveform(img, data):
    h, w, _ = img.shape
    origin_y = h - 60
    plot_w = w - 40
    
    # 绘制半透明背景
    #overlay = img.copy()
    #cv2.rectangle(overlay, (10, h-160), (w-10, h-10), (20, 20, 20), -1)
    #cv2.addWeighted(overlay, 0.7, img, 0.3, 0, img)
    
    cv2.putText(img, "2S PULSE WAVE", (20, h-140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

    if len(data) < 2: return
    points = []
    for i, val in enumerate(data):
        x = 20 + int(i * (plot_w / WAVE_LEN))
        y = origin_y - int(val * 0.3) # 2秒模式下波形拉高一点更清晰
        points.append((x, y))
    
    for i in range(len(points)-1):
        color = (0, 255, 0) if abs(data[i]) < 50 else (0, 0, 255)
        cv2.line(img, points[i], points[i+1], color, 2)

# --- 6. 实时循环 ---
cap = cv2.VideoCapture(0)
if not cap.isOpened(): cap = cv2.VideoCapture(2)

# --- 在主循环部分 (第6部分) 增加发送逻辑 ---
import time
last_send_time = 0  # 发送频率限制

print("🚀 5080 测谎系统正在满血运行...")

while True:
    ret, frame = cap.read()
    if not ret: break

    # --- 新增：相机水平镜像翻转 ---
    frame = cv2.flip(frame, 1)  # 1 代表水平翻转，0 代表垂直翻转


    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.2, 5)

    max_emo = "neutral" # 默认情绪

    for (x, y, w, h) in faces:
        face_roi = frame[y:y+h, x:x+w]
        if face_roi.size < 100: continue
        
        # 预处理
        img_input = cv2.resize(face_roi, (224, 224))
        img_input = cv2.cvtColor(img_input, cv2.COLOR_BGR2RGB)
        img_t = torch.from_numpy(img_input).float().div(255).permute(2,0,1).unsqueeze(0).to(device)
        
        # 归一化参数
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1,3,1,1).to(device)
        std = torch.tensor([0.229, 0.224, 0.225]).view(1,3,1,1).to(device)
        img_t = (img_t - mean) / std

        with torch.no_grad():
            logits = model(img_t)
            probs = torch.nn.functional.softmax(logits, dim=1).cpu().numpy()[0]
        
        emo_dict = dict(zip(EMO_LABELS, probs))
        max_emo = max(emo_dict, key=emo_dict.get)
        
        # 测谎逻辑
        is_lying = (current_bpm > 95) and (emo_dict['fear'] > 0.25 or emo_dict['contempt'] > 0.2)

        # 渲染
        color = (0, 0, 255) if is_lying else (0, 255, 0)
        cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
        cv2.putText(frame, f"BPM: {current_bpm:.1f}  {max_emo.upper()}", (x, y-10), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        
        if is_lying:
            cv2.putText(frame, "LYING DETECTED!", (30, 80), cv2.FONT_HERSHEY_TRIPLEX, 1.5, (0,0,255), 3)
            cv2.rectangle(frame, (0,0), (frame.shape[1], frame.shape[0]), (0,0,255), 15)

            
     # ★ 新增：向 STM32 回传情绪数据 (每0.5秒最多发一次，避免串口阻塞)
    # ★ 新增：通过 Wi-Fi 无线回传情绪数据给 ESP32
    if time.time() - last_send_time > 0.5:
        try:
            cmd = f"<EMO:{max_emo}>"
            udp_socket.sendto(cmd.encode('utf-8'), (ESP_IP, UDP_PORT))
            last_send_time = time.time()
        except Exception as e:
            pass

    draw_waveform(frame, list(waveform_queue))
    cv2.imshow('RTX 5080 Lie Detector', frame)
    if cv2.waitKey(1) & 0xFF == ord('q'): break

cap.release()
cv2.destroyAllWindows()
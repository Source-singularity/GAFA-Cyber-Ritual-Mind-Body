# --- 1. 在文件开头添加这个处理函数 ---
def convert_to_builtin_type(obj):
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: convert_to_builtin_type(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_to_builtin_type(i) for i in obj]
    return obj

# --- 2. 定义一个 API 类 ---
class JSApi:
    def __init__(self):
        self.window = None

    def set_window(self, window):
        self.window = window

    def toggle_fullscreen(self):
        if self.window:
            self.window.toggle_fullscreen()


import os, cv2, torch, socket, threading, time, asyncio, json, websockets, webview, base64, random, serial, serial.tools.list_ports # ★ 用于自动搜索
import numpy as np
from collections import deque

# --- 1. 基础配置 ---
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']
MODEL_PATH = os.path.expanduser(".hsemotion/enet_b2_8.pt")

# 数据共享中心 (全系统唯一的真理来源)
state = {
    "bpm": 0.0,
    "waveform": 0.0,
    "spo2": 0.0,  # ★ 新增血氧初始值
    "emotions": {label: 0.0 for label in EMO_LABELS},
    "is_lying": False,
    "max_emo": "neutral",
    "img": ""  # 用于存储 Base64 编码的图像数据
}

# --- 2. WebSocket 服务器 (广播给 React 前端) ---
async def ws_server(websocket):
    print("🌐 祭坛视觉界面已接入数据链路")
    try:
        while True:
            # ★ 重点：在 dumps 之前调用转换函数
            clean_state = convert_to_builtin_type(state)
            await websocket.send(json.dumps(clean_state))
            await asyncio.sleep(0.05)
    except websockets.exceptions.ConnectionClosed:
        print("🌐 界面连接断开")
        
def start_ws():
    async def run():
        async with websockets.serve(ws_server, "localhost", 8765):
            await asyncio.Future()
    asyncio.run(run())

# --- 新增：串口监听线程 ---
def serial_worker():
    global state
    print("🔌 串口监听线程已启动，搜索中...")
    ser = None
    while True:
        if ser is None:
            # 自动搜索可能的串口
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                if "USB" in p.description or "ACM" in p.description or "CH34" in p.description:
                    try:
                        ser = serial.Serial(p.device, 115200, timeout=0.01)
                        print(f"✅ 已通过 USB 连接到祭坛: {p.device}")
                        break
                    except: continue
            time.sleep(2) # 没找到串口则等 2 秒再试
            continue
        
        try:
            if ser.in_waiting:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line.startswith("<W:") and line.endswith(">"):
                    parts = line[1:-1].split(',')
                    for p in parts:
                        if p.startswith("W:"): state["waveform"] = float(p[2:])
                        if p.startswith("B:"): state["bpm"] = float(p[2:])
                        if p.startswith("S:"): state["spo2"] = float(p[2:])
            
            # ★ 重要：把情绪指令也写回串口，实现有线闭环控制
            # 我们直接利用 ritual_engine 算出的 max_emo
            # 这里每秒写一次
            if time.time() % 1.0 < 0.05: # 简单限流
                cmd = f"<EMO:{state['max_emo']}>\n"
                ser.write(cmd.encode())

        except Exception as e:
            print(f"🔌 串口断开: {e}")
            ser = None

# --- 3. 核心引擎 (AI 推理 + ESP32 UDP 通讯) ---
def ritual_engine():
    global state
    # A. 初始化 UDP
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.bind(("0.0.0.0", 8888))
    udp_socket.settimeout(0.01)
    ESP_IP = "192.168.4.1"

    # B. 初始化 AI 模型
    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)
    model = checkpoint if isinstance(checkpoint, torch.nn.Module) else checkpoint.get('model', checkpoint)
    model.to(DEVICE).eval()
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    cap = cv2.VideoCapture(0) 
    last_send_time = 0

    print("🚀 祭坛核心引擎已启动，正在执行监控...")

    while True:
        ret, frame = cap.read()
        if not ret: continue
        frame = cv2.flip(frame, 1)

        # ★ 关键修正 1：初始化 line，防止后面报错
        line = "" 

        # 1. 接收来自 ESP32 的生理信号
        try:
            data, addr = udp_socket.recvfrom(1024)
            line = data.decode('utf-8', errors='ignore').strip()
            
            if line.startswith("<W:") and line.endswith(">"):
                parts = line[1:-1].split(',')
                for p in parts:
                    if p.startswith("W:"): state["waveform"] = float(p[2:])
                    if p.startswith("B:"): state["bpm"] = float(p[2:])
                    if p.startswith("S:"): state["spo2"] = float(p[2:]) # ★ 提取真实的血氧值
        except: 
            pass # 没收到数据时不更新 bpm，保持旧值或等待下一帧

        # 2. AI 情绪推理 (保持不变)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.2, 5)
        
        current_max = "neutral"
        for (x, y, w, h) in faces:
            face_roi = frame[y:y+h, x:x+w]
            img_input = cv2.resize(face_roi, (224, 224))
            img_input = cv2.cvtColor(img_input, cv2.COLOR_BGR2RGB)
            img_t = torch.from_numpy(img_input).float().div(255).permute(2,0,1).unsqueeze(0).to(DEVICE)
            
            mean = torch.tensor([0.485, 0.456, 0.406]).view(1,3,1,1).to(DEVICE)
            std = torch.tensor([0.229, 0.224, 0.225]).view(1,3,1,1).to(DEVICE)
            img_t = (img_t - mean) / std

            with torch.no_grad():
                logits = model(img_t)
                probs = torch.nn.functional.softmax(logits, dim=1).cpu().numpy()[0]
            
            state["emotions"] = {label: float(p) for label, p in zip(EMO_LABELS, probs)}
            current_max = max(state["emotions"], key=state["emotions"].get)
            state["max_emo"] = current_max
            state["is_lying"] = (state["bpm"] > 95) and (state["emotions"]['fear'] > 0.25)

            # 画框代码 (保持原样)
            cv2.rectangle(frame, (x, y), (x+w, y+h), (80, 80, 80), 1)
            l, t, c = 20, 2, (200, 200, 200)
            cv2.line(frame, (x, y), (x+l, y), c, t); cv2.line(frame, (x, y), (x, y+l), c, t)
            cv2.line(frame, (x+w, y), (x+w-l, y), c, t); cv2.line(frame, (x+w, y), (x+w, y+l), c, t)
            cv2.line(frame, (x, y+h), (x+l, y+h), c, t); cv2.line(frame, (x, y+h), (x, y+h-l), c, t)
            cv2.line(frame, (x+w, y+h), (x+w-l, y+h), c, t); cv2.line(frame, (x+w, y+h), (x+w, y+h-l), c, t)
            cv2.putText(frame, f"TARGET LOCKED: {current_max.upper()}", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

        # 3. 向 ESP32 回传指令
        if time.time() - last_send_time > 0.5:
            try:
                udp_socket.sendto(f"<EMO:{current_max}>".encode(), (ESP_IP, 8888))
                last_send_time = time.time()
            except: pass

        # 4. 将画面压缩并转为 Base64 
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
        jpg_as_text = base64.b64encode(buffer).decode('utf-8')
        state["img"] = f"data:image/jpeg;base64,{jpg_as_text}"

# --- 4. 启动可视化与窗口 ---

if __name__ == "__main__":
    js_api = JSApi() # 实例化 API


    # 1. 启动 WebSocket 广播（给网页）
    threading.Thread(target=start_ws, daemon=True).start()
    
    # 2. 启动核心 AI 引擎（算情绪、抓摄像头）
    threading.Thread(target=ritual_engine, daemon=True).start()
    
    # 3. ★ 新增：启动串口引擎（抓 USB 数据）
    threading.Thread(target=serial_worker, daemon=True).start()
    
    # 允许调整大小的窗口配置
    window = webview.create_window(
        'RITUAL CONSOLE', 
        'http://localhost:3000', 
        width=1280, height=720,
        resizable=True,
        js_api=js_api, # ★ 将 API 注入窗口
        background_color='#050505'
    )
    
    js_api.set_window(window) # 让 API 类持有窗口对象
    
    os.environ['QTWEBENGINE_DISABLE_HARDWARE_ACCELERATION'] = '1'
    webview.start(gui='qt')
    
    # 禁用硬件加速环境配置保持不变
    os.environ['QTWEBENGINE_DISABLE_HARDWARE_ACCELERATION'] = '1'
    
    # 启动时可以增加全屏提示
    print("💡 提示: 窗口现在可以自由拉伸大小了")
    webview.start(gui='qt')
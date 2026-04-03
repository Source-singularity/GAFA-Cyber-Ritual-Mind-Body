# --- 1. 基础环境与工具 ---
import os, cv2, torch, socket, threading, time, asyncio, json, websockets, webview, base64, random, serial
import serial.tools.list_ports 
import numpy as np
from collections import deque

def convert_to_builtin_type(obj):
    if isinstance(obj, np.floating): return float(obj)
    if isinstance(obj, np.integer): return int(obj)
    if isinstance(obj, np.ndarray): return obj.tolist()
    if isinstance(obj, dict): return {k: convert_to_builtin_type(v) for k, v in obj.items()}
    if isinstance(obj, list): return [convert_to_builtin_type(i) for i in obj]
    return obj

class JSApi:
    def __init__(self):
        self.window = None
    def set_window(self, window):
        self.window = window
    def toggle_fullscreen(self):
        if self.window:
            self.window.toggle_fullscreen()

# --- 2. 基础配置与共享状态 ---
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
EMO_LABELS = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']
MODEL_PATH = os.path.expanduser(".hsemotion/enet_b2_8.pt")

state = {
    "bpm": 0.0,
    "waveform": 0.0,
    "spo2": 0.0,  
    "emotions": {label: 0.0 for label in EMO_LABELS},
    "is_lying": False,
    "max_emo": "neutral",
    "img": ""  
}

# 预先生成噪点模板提升性能
noise_overlay = np.random.randint(0, 40, (1080, 1920, 3), dtype=np.uint8)

def apply_tng_subspace_filter(frame):
    """
    星际迷航：下一代 (TNG) 子空间通讯滤镜 - 高亮版
    特点：高亮度、极细微扫描线、保持 CRT 模拟感。
    """
    # 1. 提升亮度 (beta) 与对比度 (alpha)
    # alpha=1.1 增加对比度防止发白，beta=35 强力提亮
    frame = cv2.convertScaleAbs(frame, alpha=1.1, beta=35)

    # 2. 轻微柔化 (模拟老式光学镜头)
    frame = cv2.GaussianBlur(frame, (3, 3), 0)

    # 3. 饱和度微调
    # 提亮后颜色容易变淡，我们将饱和度维持在 0.9，保持克制但有气色
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    s = cv2.multiply(s, 0.9) 
    hsv = cv2.merge((h, s, v))
    frame = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    # 4. CRT 色彩偏移 (红蓝通道错位)
    # 保持 1 个像素的错位，模拟显像管物理感，由于亮度高，这种边缘重影会很高级
    b, g, r = cv2.split(frame)
    r = np.roll(r, 1, axis=1) # 红色向右偏 1
    b = np.roll(b, -1, axis=1) # 蓝色向左偏 1
    frame = cv2.merge((b, g, r))

    # 5. 淡化后的 TNG 扫描线 (Scanlines)
    # 提亮后，扫描线如果太黑会很难看。我们把变暗比例调到 0.92 (只减弱 8%)
    h, w = frame.shape[:2]
    frame_float = frame.astype(np.float32)
    # 每隔 3 行加一条浅色的扫描线
    frame_float[::3, :] *= 0.92
    frame = frame_float.astype(np.uint8)

    return frame

# --- 4. WebSocket 广播 ---
async def ws_server(websocket):
    print("🌐 祭坛视觉界面已接入数据链路")
    try:
        while True:
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

# --- 5. USB 串口监听引擎 ---
def serial_worker():
    global state
    print("🔌 串口监听线程已启动，搜索中...")
    ser = None
    while True:
        if ser is None:
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                if "USB" in p.description or "ACM" in p.description or "CH34" in p.description:
                    try:
                        ser = serial.Serial(p.device, 115200, timeout=0.01)
                        print(f"✅ 已通过 USB 连接到祭坛: {p.device}")
                        break
                    except: continue
            time.sleep(2) 
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
            
            # 每秒向 USB 回传一次指令
            if time.time() % 1.0 < 0.05: 
                cmd = f"<EMO:{state['max_emo']}>\n"
                ser.write(cmd.encode())
        except Exception as e:
            print(f"🔌 串口断开: {e}")
            ser = None

# --- 6. AI 与 UDP 核心引擎 ---
def ritual_engine():
    global state
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.bind(("0.0.0.0", 8888))
    udp_socket.settimeout(0.01)
    ESP_IP = "192.168.4.1"

    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=False)
    model = checkpoint if isinstance(checkpoint, torch.nn.Module) else checkpoint.get('model', checkpoint)
    model.to(DEVICE).eval()
    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    cap = cv2.VideoCapture(0)
    # 提升采集分辨率，增强电影感
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    last_send_time = 0

    print("🚀 祭坛核心引擎已启动，正在执行监控...")

    while True:
        ret, frame = cap.read()
        if not ret: continue
        frame = cv2.flip(frame, 1)

        # 1. 接收无线 UDP 数据
        try:
            data, addr = udp_socket.recvfrom(1024)
            line = data.decode('utf-8', errors='ignore').strip()
            if line.startswith("<W:") and line.endswith(">"):
                parts = line[1:-1].split(',')
                for p in parts:
                    if p.startswith("W:"): state["waveform"] = float(p[2:])
                    if p.startswith("B:"): state["bpm"] = float(p[2:])
                    if p.startswith("S:"): state["spo2"] = float(p[2:])
        except: pass

        # 2. AI 情绪推理
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

            # 赛博人脸锁定框
            cv2.rectangle(frame, (x, y), (x+w, y+h), (80, 80, 80), 1)
            l, t, c = 20, 2, (200, 200, 200)
            cv2.line(frame, (x, y), (x+l, y), c, t); cv2.line(frame, (x, y), (x, y+l), c, t)
            cv2.line(frame, (x+w, y), (x+w-l, y), c, t); cv2.line(frame, (x+w, y), (x+w, y+l), c, t)
            cv2.line(frame, (x, y+h), (x+l, y+h), c, t); cv2.line(frame, (x, y+h), (x, y+h-l), c, t)
            cv2.line(frame, (x+w, y+h), (x+w-l, y+h), c, t); cv2.line(frame, (x+w, y+h), (x+w, y+h-l), c, t)
            cv2.putText(frame, f"TARGET LOCKED: {current_max.upper()}", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 100, 0), 1)

        # 3. 向 ESP32 回传无线 UDP 指令
        if time.time() - last_send_time > 0.5:
            try:
                udp_socket.sendto(f"<EMO:{current_max}>".encode(), (ESP_IP, 8888))
                last_send_time = time.time()
            except: pass

        # ★ 4. 画面后期处理：TNG 子空间通讯滤镜
        tng_frame = apply_tng_subspace_filter(frame)

        # 将加了滤镜的画面压缩发给网页 (质量 50 足够，配合 TNG 风格刚刚好)
        _, buffer = cv2.imencode('.jpg', tng_frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
        jpg_as_text = base64.b64encode(buffer).decode('utf-8')
        state["img"] = f"data:image/jpeg;base64,{jpg_as_text}"

# --- 7. 启动可视化与窗口 ---
if __name__ == "__main__":
    js_api = JSApi() 

    # 启动所有后台线程
    threading.Thread(target=start_ws, daemon=True).start()
    threading.Thread(target=ritual_engine, daemon=True).start()
    threading.Thread(target=serial_worker, daemon=True).start()
    
    os.environ['QTWEBENGINE_DISABLE_HARDWARE_ACCELERATION'] = '1'
    print("💡 提示: 窗口已就绪，可在网页中按 F11 切换全屏")

    # 创建并启动窗口 (清理了之前重复的代码)
    window = webview.create_window(
        'RITUAL CONSOLE', 
        'http://localhost:3000', 
        width=1280, height=720,
        resizable=True,
        js_api=js_api,
        background_color='#050505'
    )
    js_api.set_window(window) 
    webview.start(gui='qt')
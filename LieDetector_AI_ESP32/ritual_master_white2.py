import os, cv2, torch, socket, threading, time, asyncio, json, websockets, webview, base64
import serial.tools.list_ports
import serial
import torch.nn as nn
import numpy as np
import dlib
from collections import deque
import torchvision.transforms as transforms
from model.MEFL import MEFARG
from model.resnet import ResNet, Bottleneck

# ==========================================
# 0. 核心环境拦截器
# ==========================================
original_load = torch.load
def mocked_load(f, *args, **kwargs):
    if isinstance(f, str) and 'resnet50' in f and 'OpenGprahAU' not in f:
        return {'model': {}, 'state_dict': {}}
    return original_load(f, *args, **kwargs)
torch.load = mocked_load

original_load_state_dict = nn.Module.load_state_dict
def mocked_load_state_dict(self, state_dict, strict=True):
    if not state_dict or (isinstance(state_dict, dict) and len(state_dict) <= 2): return None
    return original_load_state_dict(self, state_dict, strict=False)
nn.Module.load_state_dict = mocked_load_state_dict

# ==========================================
# 1. 基础配置与全局状态
# ==========================================
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
AU_MODEL_PATH = "checkpoints/OpenGprahAU-ResNet50_second_stage.pth"
PREDICTOR_PATH = "tool/shape_predictor_68_face_landmarks.dat"
EMO_KEYS =['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']

class RitualState:
    CALIBRATING = "CALIBRATING"
    CHOOSING = "CHOOSING"
    TESTING = "TESTING"
    REPORTING = "REPORTING"

state = {
    "status": RitualState.CALIBRATING,
    "choice": "",
    "bpm": 0.0, "waveform": 0.0, "spo2": 0.0,
    "emotions": {key: 0.0 for key in EMO_KEYS},
    "max_emo": "neutral",
    "support_index": 100.0,
    "sampling_progress": 0,
    "pulse_count": 0,
    "img": "",
    "is_paused": False,
    "last_pulse_time": 0 # ✨ 用于触发下位机物理痉挛
}

sampling_bucket = { "macro_history":[], "micro_pulses": 0 }
global_engine = None

# --- [ 统一数据解析 ] ---
def parse_esp32_data(line):
    """解析来自 USB 或 WiFi 的下位机数据"""
    if line.startswith("<W:") and line.endswith(">"):
        try:
            parts = line[1:-1].split(',')
            for p in parts:
                if p.startswith("W:"): state["waveform"] = float(p[2:])
                if p.startswith("B:"): state["bpm"] = float(p[2:])
                if p.startswith("S:"): state["spo2"] = float(p[2:])
        except: pass

# ==========================================
# 2. 物理层深度集成：双路通信与痉挛指令
# ==========================================
def serial_worker():
    global state
    print("🔌 串口监听线程已启动，正在扫描祭坛硬件...")
    ser = None
    while True:
        if ser is None:
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                if any(x in p.description for x in ["USB", "ACM", "CH34", "CP210"]):
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
                parse_esp32_data(line)
            
            if time.time() % 0.1 < 0.02:
                # 物理痉挛指令 (Jitter): 当主情绪为恐惧，或 0.5 秒内发生过微表情抽动时激活
                jitter = 1 if (state["max_emo"] == "fear" or state["last_pulse_time"] > time.time() - 0.5) else 0
                cmd = f"<M:{state['status']},E:{state['max_emo']},J:{jitter}>\n"
                ser.write(cmd.encode())
        except Exception as e:
            print(f"🔌 串口断开: {e}")
            ser = None

# ==========================================
# 3. 视觉中枢：FACS 引擎
# ==========================================
class InquiryEngine:
    def __init__(self):
        print("🚀 [InquiryEngine] 正在加载 41 维面部动作编码系统 (FACS)...")
        self.net = MEFARG(num_main_classes=27, num_sub_classes=14, backbone='resnet50')
        torch.load = original_load
        nn.Module.load_state_dict = original_load_state_dict
        ckpt = torch.load(AU_MODEL_PATH, map_location=DEVICE)
        new_sd = { (k[7:] if k.startswith('module.') else k): v for k, v in (ckpt['state_dict'] if 'state_dict' in ckpt else ckpt).items() }
        self.net.load_state_dict(new_sd, strict=False)
        self.net.to(DEVICE).eval()
        self.detector = dlib.get_frontal_face_detector()
        self.predictor = dlib.shape_predictor(PREDICTOR_PATH)
        self.transform = transforms.Compose([
            transforms.ToPILImage(), transforms.Resize((224, 224)),
            transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406],[0.229, 0.224, 0.225])
        ])
        self.baseline_aus = None
        self.calibration_frames = 0

    def get_au_and_face(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        rects = self.detector(gray, 0)
        if len(rects) == 0: return None, None
        r = rects[0]
        face_img = frame[max(0,r.top()):r.bottom(), max(0,r.left()):r.right()]
        if face_img.size == 0: return None, None
        input_tensor = self.transform(cv2.resize(face_img,(224,224))).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            logits = self.net(input_tensor)
            raw_au = torch.sigmoid(logits[0] if isinstance(logits, (list, tuple)) else logits).cpu().numpy()[0]
            if self.calibration_frames < 30:
                if self.baseline_aus is None: self.baseline_aus = raw_au
                else: self.baseline_aus = self.baseline_aus * 0.9 + raw_au * 0.1
                self.calibration_frames += 1
                return None, (r.left(), r.top(), r.width(), r.height())
            return np.maximum(0, raw_au - self.baseline_aus), (r.left(), r.top(), r.width(), r.height())

# ==========================================
# 4. 终极法庭：详细的报告结算算法
# ==========================================
def return_to_choosing():
    state["status"] = RitualState.CHOOSING
    print("🔄 报告期结束，自动切回红蓝抉择页...")

def calculate_ritual_final():
    if not sampling_bucket["macro_history"]: return 0.0
    history = sampling_bucket["macro_history"]
    total_frames = len(history)
    
    threshold = 0.35 
    time_counts = {k: 0 for k in EMO_KEYS}
    for frame in history:
        for k in EMO_KEYS:
            if frame[k] > threshold: time_counts[k] += 1
                
    # 宏观常态扣分
    macro_penalty = (
        (time_counts["anger"] / total_frames) * 100.0 * 1.0 +    
        (time_counts["disgust"] / total_frames) * 100.0 * 0.8 +
        (time_counts["contempt"] / total_frames) * 100.0 * 0.6 +
        (time_counts["fear"] / total_frames) * 100.0 * 0.5 +
        (time_counts["sadness"] / total_frames) * 100.0 * 0.3
    )
    # 正向护盾加分
    positive_reward = (
        (time_counts["happiness"] / total_frames) * 100.0 * 0.8 +
        (time_counts["surprise"] / total_frames) * 100.0 * 0.4
    )
    
    # 潜意识猎杀惩罚
    pulses = sampling_bucket["micro_pulses"]
    micro_penalty = pulses * 15.0

    final_score = 100.0 - macro_penalty + positive_reward - micro_penalty
    
    # 立场矛盾算法
    if state["choice"] == "blue" and (macro_penalty > 30 or micro_penalty >= 15):
        print("⚠️ 虚伪判定：声明接受，但潜意识强烈排斥。追加 15 分惩罚！")
        final_score -= 15.0

    final_score = float(np.clip(final_score, 0, 100))
    
    # 打印法医级详细报告
    print(f"\n📊 --- 主体性验证报告 ---")
    print(f"常态罚分: -{macro_penalty:.1f} (愤怒:{time_counts['anger']}帧, 厌恶:{time_counts['disgust']}帧)")
    print(f"常态护盾: +{positive_reward:.1f} (开心:{time_counts['happiness']}帧, 惊讶:{time_counts['surprise']}帧)")
    print(f"心智裂缝: {pulses}次 (罚分 -{micro_penalty:.1f})")
    print(f"最终支持度: {final_score:.1f}%\n")
    
    threading.Timer(8.0, return_to_choosing).start()
    return final_score

# ==========================================
# 5. 核心主控流：Ritual Engine
# ==========================================
def ritual_engine():
    global global_engine, state
    try:
        engine = InquiryEngine()
        global_engine = engine
        cap = cv2.VideoCapture(0)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.bind(("0.0.0.0", 8888))
        udp_sock.settimeout(0.001)
        ESP_IP = "192.168.4.1"

        micro_window = deque(maxlen=15) 
        pulse_cooldown = 0
        last_udp_time = 0

        while True:
            ret, frame = cap.read()
            if not ret: continue
            frame = cv2.flip(frame, 1)

            # WiFi UDP 接收
            try:
                data, _ = udp_sock.recvfrom(1024)
                parse_esp32_data(data.decode('utf-8', errors='ignore').strip())
            except: pass

            # 软休眠调度
            if state["status"] in[RitualState.CHOOSING, RitualState.REPORTING]:
                tng = cv2.convertScaleAbs(frame, alpha=1.1, beta=10)
                _, buf = cv2.imencode('.jpg', tng, [cv2.IMWRITE_JPEG_QUALITY, 30])
                state["img"] = f"data:image/jpeg;base64,{base64.b64encode(buf).decode()}"
                time.sleep(0.04)
                continue

            # AI 推理
            au, box = engine.get_au_and_face(frame)
            
            if state["status"] == RitualState.CALIBRATING and engine.calibration_frames >= 30:
                print("✅ 基准建立完成，进入红蓝选择页...")
                state["status"] = RitualState.CHOOSING
                continue

            if au is not None and state["status"] == RitualState.TESTING:
                # 高阶 FACS 矩阵重置
                raw_ids =['1','2','4','5','6','7','9','10','11','12','13','14','15','16','17','18','19','20','22','23','24','25','26','27','32','38','39']
                p = { f"AU{raw_ids[i]}": float(au[i]) for i in range(27) }
                p["AU1"] = max(p.get("AU1",0), float(au[27]), float(au[28]))
                p["AU2"] = max(p.get("AU2",0), float(au[29]), float(au[30]))
                p["AU4"] = max(p.get("AU4",0), float(au[31]), float(au[32]))
                p["AU6"] = max(p.get("AU6",0), float(au[33]), float(au[34]))
                p["AU10"]= max(p.get("AU10",0), float(au[35]), float(au[36]))
                p["AU12"]= max(p.get("AU12",0), float(au[37]), float(au[38]))
                p["AU14"]= max(p.get("AU14",0), float(au[39]), float(au[40]))

                smile_intensity = p["AU12"] * 1.2 + p.get("AU6",0) * 0.8
                is_smiling = smile_intensity > 0.35

                raw_emo = {
                    "happiness": smile_intensity,
                    "sadness": p["AU1"]*1.2 + p["AU4"]*0.5 + p.get("AU15",0)*1.8 + p.get("AU17",0)*1.2,
                    "anger": 0 if is_smiling else (p["AU4"]*1.8 + p.get("AU7",0)*0.8 + p.get("AU24",0)*1.0),
                    "fear": p["AU1"]*0.8 + p.get("AU2",0)*0.8 + p["AU4"]*0.5 + p.get("AU5",0)*1.2,
                    "disgust": 0 if is_smiling else (p.get("AU9",0)*2.0 + p["AU10"]*1.2),
                    "surprise": p["AU1"]*0.8 + p.get("AU2",0)*0.8 + p.get("AU26",0)*1.5,
                    "contempt": 0 if is_smiling else p["AU14"]*2.2
                }

                # 提取主导情绪
                GAIN = 2.2 
                active_sum = 0
                for k in EMO_KEYS:
                    if k != "neutral":
                        val = np.clip(raw_emo.get(k, 0) * GAIN, 0, 1.0)
                        state["emotions"][k] = float(val)
                        active_sum += val
                state["emotions"]["neutral"] = float(np.clip(1.2 - active_sum, 0, 1.0))
                state["max_emo"] = max(state["emotions"], key=state["emotions"].get)

                # --- 动态采样与脉冲猎杀 (支持暂停) ---
                if not state["is_paused"]:
                    if pulse_cooldown > 0: 
                        pulse_cooldown -= 1
                    else:
                        micro_window.append({
                            "AU4": p["AU4"], "AU9": p.get("AU9",0), 
                            "AU14": p["AU14"], "AU15": p.get("AU15",0)
                        })
                        
                        if len(micro_window) == 15:
                            for target in["AU4", "AU9", "AU14", "AU15"]:
                                track = [f[target] for f in micro_window]
                                start_val = min(track[0:4])
                                apex_val = max(track[4:11])
                                end_val = min(track[11:15])
                                
                                # 脉冲判定：幅度 > 0.08 且有回落迹象
                                if (apex_val - start_val > 0.08) and (apex_val - end_val > 0.04):
                                    if not is_smiling:
                                        sampling_bucket["micro_pulses"] += 1
                                        state["pulse_count"] = sampling_bucket["micro_pulses"]
                                        state["last_pulse_time"] = time.time() # ✨ 触发物理痉挛
                                        print(f"⚡ 猎杀！捕捉到 {target} 极速抽动 (幅度:{apex_val-start_val:.2f}) -> 扣除 15 分！")
                                        pulse_cooldown = 15 # 冷却防连击
                                        micro_window.clear()
                                        break 

                    # 记录进度
                    sampling_bucket["macro_history"].append(state["emotions"].copy())
                    state["sampling_progress"] += 0.2 # 进度步进控制
                    
                    if state["sampling_progress"] >= 100:
                        state["support_index"] = calculate_ritual_final()
                        state["status"] = RitualState.REPORTING

            # WiFi UDP 下发
            if time.time() - last_udp_time > 0.1:
                jitter = 1 if (state["max_emo"] == "fear" or state["last_pulse_time"] > time.time() - 0.5) else 0
                cmd = f"<M:{state['status']},E:{state['max_emo']},J:{jitter}>"
                try: udp_sock.sendto(cmd.encode(), (ESP_IP, 8888))
                except: pass
                last_udp_time = time.time()

            # 视觉渲染
            tng = cv2.convertScaleAbs(frame, alpha=1.1, beta=10)
            b,g,r = cv2.split(tng); tng = cv2.merge((np.roll(b,-1,1), g, np.roll(r,1,1)))
            tng[::3, :] = (tng[::3, :].astype(np.float32)*0.85).astype(np.uint8)

            if box and state["status"] in[RitualState.TESTING, RitualState.CALIBRATING]:
                x, y, w, h = box
                cv2.rectangle(tng, (x, y), (x+w, y+h), (120, 120, 120), 1)
                info_text = f"TARGET: {state['max_emo'].upper()} | PULSE: {state['pulse_count']}"
                cv2.putText(tng, info_text, (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 200, 0), 1)

            _, buf = cv2.imencode('.jpg', tng,[cv2.IMWRITE_JPEG_QUALITY, 40])
            state["img"] = f"data:image/jpeg;base64,{base64.b64encode(buf).decode()}"
            time.sleep(0.01)

    except Exception as e: print(f"❌ 引擎故障: {e}"); import traceback; traceback.print_exc()

# ==========================================
# 6. JS API 与 Web 启动
# ==========================================
class JSApi:
    def trigger_ritual(self):
        # 兼容旧逻辑：没在测试就进测试，在测试就暂停
        if state["status"] == RitualState.CHOOSING:
            self.make_choice("blue")
        elif state["status"] == RitualState.TESTING:
            self.toggle_pause()

    def make_choice(self, choice):
        state["choice"] = choice
        state["status"] = RitualState.TESTING
        state["sampling_progress"] = 0
        state["pulse_count"] = 0
        state["is_paused"] = False 
        sampling_bucket["macro_history"].clear()
        sampling_bucket["micro_pulses"] = 0
        print(f"🔔 玩家宣称:[{choice.upper()}]。系统切入临床审讯模式。")

    def toggle_pause(self):
        if state["status"] == RitualState.TESTING:
            state["is_paused"] = not state.get("is_paused", False)
            p_status = "⏸ 暂停" if state["is_paused"] else "▶ 继续"
            print(f"仪器状态: {p_status}")

    def calibrate(self):
        global global_engine
        if global_engine: 
            print("🎯 重置大循环：进入自然状态基准采集...")
            global_engine.calibration_frames = 0
            global_engine.baseline_aus = None
            state["status"] = RitualState.CALIBRATING
            
    def stop_sampling(self): 
        if state["status"] == RitualState.TESTING:
            state["sampling_progress"] = 100
        
    def toggle_fullscreen(self): 
        window.toggle_fullscreen()

async def ws_server():
    async with websockets.serve(lambda ws: ws_logic(ws), "localhost", 8765): await asyncio.Future()

async def ws_logic(ws):
    while True:
        try:
            await ws.send(json.dumps(state)); await asyncio.sleep(0.05)
        except: break

if __name__ == "__main__":
    # 启动双路通信与 AI
    threading.Thread(target=serial_worker, daemon=True).start()
    threading.Thread(target=lambda: asyncio.run(ws_server()), daemon=True).start()
    threading.Thread(target=ritual_engine, daemon=True).start()
    
    os.environ['QTWEBENGINE_DISABLE_HARDWARE_ACCELERATION'] = '1'
    window = webview.create_window('RITUAL CONSOLE THE HUNTER', 'http://localhost:3000', js_api=JSApi(), width=1280, height=720)
    webview.start(gui='qt')
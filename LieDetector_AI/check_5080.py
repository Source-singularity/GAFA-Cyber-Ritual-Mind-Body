import os
# 核心设置：强制 Keras 使用 PyTorch 后端
os.environ["KERAS_BACKEND"] = "torch"

import keras
import torch

print(f"--- 硬件检测 ---")
print(f"PyTorch 版本: {torch.__version__}")
print(f"CUDA 是否可用: {torch.cuda.is_available()}")
print(f"当前显卡: {torch.cuda.get_device_name(0)}")
print(f"显卡算力指令集: {torch.cuda.get_device_capability(0)}") # 应该显示 (12, 0)

print(f"\n--- 框架检测 ---")
print(f"Keras 当前后端: {keras.config.backend()}") # 应该显示 'torch'
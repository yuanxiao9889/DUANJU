# Qwen3 TTS 完整扩展包规划

## 目标

做一个可插入 Storyboard Copilot 扩展中心的真实 Qwen3 TTS 扩展包，用于后续真实测试，而不是只跑 mock 流程。

这份规划优先回答 4 个问题：

1. 本地整合包里哪些东西必须保留。
2. 官方仓库里哪些能力应该作为运行时主干。
3. 哪些 WebUI / Demo / 开发文件可以删。
4. 我们自己的扩展包目录应该长什么样，后续怎么接入画布节点。

## 已确认的来源

### 本地整合包

- 路径：`I:\Qwen3-TTS-1.7B\Qwen3-TTS`
- 重要内容：
  - `Qwen3-TTS-12Hz-1.7B-Base`
  - `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
  - `Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `Qwen3-TTS-Tokenizer-12Hz`
  - `qwen_tts`
  - `wzf312`
  - `wzf312\Tools\sox`

### 官方仓库

- 仓库：[QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- 官方 README 明确支持：
  - `generate_voice_design`
  - `generate_custom_voice`
  - `create_voice_clone_prompt`
  - `generate_voice_clone`
  - 以及 “Voice Design then Clone” 工作流

## 当前结论

### 1. 真实扩展包完全可以做

本地整合包不是单纯的 Gradio 演示，而是一个离线可运行的完整分发：

- 离线模型权重
- Tokenizer
- Python 运行环境
- `qwen_tts` 官方包代码
- SoX 工具

所以后续不需要围着 WebUI 改，我们可以把它拆成：

- 官方 Qwen3-TTS 推理层
- 我们自己的桥接脚本
- 我们自己的扩展包 manifest
- 我们自己的节点/UI 层

### 2. 真正需要保留的核心，比 WebUI 少很多

运行真实能力的核心，不是 `gradio demo`，而是：

- `qwen_tts\core`
- `qwen_tts\inference`
- 三个模型目录
- `Qwen3-TTS-Tokenizer-12Hz`
- Python 运行时
- SoX

官方 `examples/` 已经足够说明最小推理调用方式，后续桥接层应该直接复用这些 API，而不是启动 `qwen_tts.cli.demo`。

### 3. 只删 WebUI，包体不会显著变小

本地整合包主要体积来源已经确认：

- `wzf312` 约 `8.4 GB`
- `Qwen3-TTS-12Hz-1.7B-Base` 约 `4.23 GB`
- `Qwen3-TTS-12Hz-1.7B-VoiceDesign` 约 `4.21 GB`
- `Qwen3-TTS-12Hz-1.7B-CustomVoice` 约 `4.21 GB`
- `Qwen3-TTS-Tokenizer-12Hz` 约 `0.64 GB`

其中 Python 环境里最大的单项是：

- `torch` 约 `6.91 GB`

因此：

- 删除 `gradio`、批处理、文档、示例脚本，只能小幅减重。
- 如果还保留本地 GPU 推理能力，完整扩展包大概率仍然会在 `20 GB` 左右。
- 想显著瘦身，必须走量化模型、远程推理或重新设计运行时，不是简单“删 WebUI”能解决。

## 推荐方案

## 方案定位

建议分两步做，而不是一步追求“又小又全”。

### Phase A：先做可真实测试的完整包

目标：最快拿到一个可真实生成音频的扩展包。

特点：

- 直接复用本地整合包里的 Python 运行时和模型资产。
- 去掉 Gradio、批处理和无关目录。
- 新增我们自己的桥接脚本和 manifest。
- 包体大，但最稳，最适合先验证真实链路。

### Phase B：再做瘦身版

目标：在真实链路跑稳之后，再讨论如何缩包。

特点：

- 重新构建 Python 运行时。
- 只保留必需依赖。
- 评估是否必须保留 3 个 1.7B 模型全部在包内。

注意：

- 这一阶段不建议和 Phase A 并行。
- 现在先做瘦身，会严重拖慢真实测试。

## 扩展包目录建议

建议最终扩展包采用这样的结构：

```text
qwen3-tts-complete/
  storyboard-extension.json
  README.md
  runtime/
    python/
      ...
    app/
      qwen_tts/
        core/
        inference/
        __init__.py
      storyboard_qwen_runner.py
      requirements.lock.txt
    models/
      Qwen3-TTS-12Hz-1.7B-Base/
      Qwen3-TTS-12Hz-1.7B-VoiceDesign/
      Qwen3-TTS-12Hz-1.7B-CustomVoice/
      Qwen3-TTS-Tokenizer-12Hz/
    tools/
      sox/
    cache/
    outputs/
    voices/
  docs/
    package-notes.md
```

## 建议保留的内容

从本地整合包中保留：

- `Qwen3-TTS-12Hz-1.7B-Base`
- `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- `Qwen3-TTS-12Hz-1.7B-CustomVoice`
- `Qwen3-TTS-Tokenizer-12Hz`
- `qwen_tts\core`
- `qwen_tts\inference`
- `qwen_tts\__init__.py`
- Python 运行时
- SoX 工具

从官方仓库中对齐或补充：

- `examples/test_model_12hz_voice_design.py` 对应的调用方式
- `examples/test_model_12hz_custom_voice.py` 对应的调用方式
- `examples/test_model_12hz_base.py` 对应的调用方式
- 官方 README 中 “Voice Design then Clone” 的工作流

## 可以删掉的内容

在扩展包交付时可以删除：

- `.git`
- `.github`
- `assets`
- `finetuning`
- `qwen_tts/cli/demo.py`
- 所有 `.bat` 启动器
- `qwen_tts.egg-info`
- `音色文件`
- `音频数据`

`examples/` 有两种处理方式：

- 开发版保留，用于自测。
- 发布版移除，减少噪音。

## 我们自己的桥接层建议

扩展包里不要直接启动 Gradio。

应该新增一个我们自己的桥接入口，例如：

`runtime/app/storyboard_qwen_runner.py`

它负责接受 JSON 请求并输出 JSON 响应。

建议支持这些命令：

1. `health`
2. `list_models`
3. `warmup`
4. `generate_voice_design`
5. `generate_custom_voice`
6. `create_voice_clone_prompt`
7. `generate_voice_clone`

输入输出建议：

- 输入：JSON 文件路径或 stdin
- 输出：JSON 到 stdout
- 音频文件：落到 `runtime/outputs/`
- 可复用 voice prompt：落到 `runtime/voices/`

这样前端和 Rust 侧只需要管：

- 启动 runner
- 发请求
- 等待结果
- 把输出音频注册进画布节点

## 启动流程建议

完整扩展包启用时，建议按下面的启动步骤走：

1. 校验扩展目录结构
2. 校验 Python 运行时是否存在
3. 校验 3 个模型目录与 tokenizer 是否齐全
4. 校验 SoX 是否可调用
5. 进行一次 `health` 检查
6. 进行一次轻量 `warmup`
7. 注册节点与能力

这可以直接映射到扩展中心的进度条步骤。

## 节点能力规划

为了尽快进入真实测试，建议真实版先做 4 个节点：

1. `TTS 文本`
2. `声音设计`
3. `预设音色`
4. `声音克隆`

第一版先不做太碎的 ComfyUI 式拆分，原因是：

- 先验证真实音频是否稳定生成
- 先验证本地模型加载与 GPU 运行是否稳定
- 先验证 VoiceDesign -> Clone 是否可复用

后续再根据 ComfyUI 节点拆成更细颗粒度：

- `Create Clone Prompt`
- `Load Voice Prompt`
- `Save Voice Prompt`
- `Role Bank`
- `Dialogue Inference`

## 推荐的真实测试路径

真实测试优先走这三条：

### 路径 1：声音设计

- 文本节点 -> 声音设计节点 -> 音频节点

对应官方能力：

- `generate_voice_design`

### 路径 2：预设音色

- 文本节点 -> 预设音色节点 -> 音频节点

对应官方能力：

- `generate_custom_voice`

### 路径 3：声音设计后复用

- 文本节点 -> 声音设计节点 -> 生成参考音
- 参考音 -> 创建 clone prompt
- 新文本 -> 声音克隆 -> 连续生成多句

对应官方能力：

- `generate_voice_design`
- `create_voice_clone_prompt`
- `generate_voice_clone`

这是最值得优先验证的一条，因为它最接近“角色声音资产化”。

## 和 Storyboard Copilot 的接入建议

后续需要新增一个真正的运行时管理层，而不是只在前端拼接命令。

建议新增：

- Rust 命令：扩展运行时启动 / 停止 / 调用
- 扩展进程管理器：跟踪 runner 进程
- 输出音频落盘命令
- 扩展错误转译

推荐的数据流：

```text
Canvas Node
  -> extensionsStore / extension runtime service
  -> Tauri command
  -> Python runner
  -> output wav / prompt file
  -> prepareNodeAudioFromFile
  -> audioNode
```

## 真实扩展包的 manifest 建议

下一版 manifest 建议至少增加这些字段：

```json
{
  "schemaVersion": 2,
  "id": "qwen3-tts-complete",
  "name": "Qwen3 TTS Complete",
  "version": "0.1.0",
  "description": "Full offline Qwen3 TTS runtime package for Storyboard Copilot.",
  "runtime": "python-bridge",
  "entry": {
    "kind": "python",
    "script": "runtime/app/storyboard_qwen_runner.py",
    "python": "runtime/python/python.exe"
  },
  "models": [
    "runtime/models/Qwen3-TTS-12Hz-1.7B-Base",
    "runtime/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "runtime/models/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "runtime/models/Qwen3-TTS-Tokenizer-12Hz"
  ],
  "features": {
    "nodes": [
      "ttsTextNode",
      "ttsVoiceDesignNode",
      "ttsCustomVoiceNode",
      "ttsVoiceCloneNode"
    ]
  }
}
```

## 最终建议

当前最推荐的执行顺序是：

1. 先做 `qwen3-tts-complete` 的目录骨架。
2. 先按 Phase A 复用本地整合包里的运行时和模型。
3. 去掉 Gradio 和批处理，改成我们自己的 `storyboard_qwen_runner.py`。
4. 先打通 3 条真实测试路径。
5. 等真实链路稳定后，再讨论缩包和更细节点拆分。

## 下一步实施清单

下一次真正开始做完整扩展包时，建议直接按这个顺序施工：

1. 新建 `extension-packages/qwen3-tts-complete/`
2. 复制并整理运行时目录
3. 编写 `storyboard_qwen_runner.py`
4. 增加 Tauri 侧进程调用命令
5. 接入真实 `声音设计` 节点
6. 接入真实 `预设音色` 节点
7. 接入真实 `声音克隆` 节点
8. 做一次完整真实测试


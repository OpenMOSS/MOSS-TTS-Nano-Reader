# MOSS-TTS-Nano Reader

<br>

<p align="center">
  <img src="./assets/images/OpenMOSS_Logo.png" height="70" align="middle" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./assets/images/mosi-logo.png" height="50" align="middle" />
</p>

<div align="center">
  <a href="https://clawhub.ai/luogao2333/moss-tts-voice"><img src="https://img.shields.io/badge/🦞_OpenClaw-Skills-8A2BE2" alt="OpenClaw"></a>
  <a href="https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano"><img src="https://img.shields.io/badge/Huggingface-Models-orange?logo=huggingface&amp"></a>
  <a href="https://modelscope.cn/collections/OpenMOSS-Team/MOSS-TTS-Nano"><img src="https://img.shields.io/badge/ModelScope-Models-lightgrey?logo=modelscope&amp"></a>
  <a href="https://mosi.cn/#models"><img src="https://img.shields.io/badge/Blog-View-blue?logo=internet-explorer&amp"></a>
  <a href="https://arxiv.org/abs/2603.18090"><img src="https://img.shields.io/badge/Arxiv-2603.18090-red?logo=arxiv&amp"></a>
  <a href="https://studio.mosi.cn/experiments/moss-tts-nano"><img src="https://img.shields.io/badge/AIStudio-Try-green?logo=internet-explorer&amp"></a>
  <a href="https://studio.mosi.cn/docs/moss-tts-nano"><img src="https://img.shields.io/badge/API-Docs-00A3FF?logo=fastapi&amp"></a>
  <a href="https://x.com/Open_MOSS"><img src="https://img.shields.io/badge/Twitter-Follow-black?logo=x&amp"></a>
  <a href="https://discord.gg/Xf3aXddCjc"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&amp"></a>
  <a href="./assets/images/wechat.jpg"><img src="https://img.shields.io/badge/WeChat-Join-07C160?logo=wechat&amp;logoColor=white" alt="WeChat"></a>
</div>

[English](README.md) | [简体中文](README_zh.md)

MOSS-TTS-Nano Reader 是一个基于 [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano) 的本地浏览器朗读应用。它将 Chrome 扩展、本地 Flask 服务、音色元数据映射和适合 CPU 的流式推理组合在一起，让网页内容可以直接在本机被朗读出来。

## 新闻

* 2026.4.13：我们发布 **MOSS-TTS-Nano Reader**，这是一个构建在 **MOSS-TTS-Nano** 之上的浏览器端本地朗读集成项目。
* 2026.4.10：我们发布了 **MOSS-TTS-Nano**。演示 Space 已在 [OpenMOSS-Team/MOSS-TTS-Nano](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-TTS-Nano) 上线，也可以通过 [openmoss.github.io/MOSS-TTS-Nano-Demo/](https://openmoss.github.io/MOSS-TTS-Nano-Demo/) 查看 demo 和更多细节。

## 演示

![Nano Reader demo](./assets/images/demo.jpg)

- 在线演示：[https://openmoss.github.io/MOSS-TTS-Nano-Demo/](https://openmoss.github.io/MOSS-TTS-Nano-Demo/)
- Hugging Face Space：[OpenMOSS-Team/MOSS-TTS-Nano](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-TTS-Nano)

## 目录

- [新闻](#新闻)
- [演示](#演示)
- [介绍](#介绍)
  - [主要特性](#主要特性)
- [支持的语言](#支持的语言)
- [快速开始](#快速开始)
  - [环境配置](#环境配置)
  - [准备项目目录布局](#准备项目目录布局)
  - [启动本地 Nano Reader 服务](#启动本地-nano-reader-服务)
  - [加载 Chrome 扩展](#加载-chrome-扩展)
  - [在浏览器中朗读页面](#在浏览器中朗读页面)
- [致谢](#致谢)
- [MOSS-Audio-Tokenizer-Nano](#moss-audio-tokenizer-nano)
- [许可证](#许可证)
- [引用](#引用)

## 介绍

<p align="center">
  <img src="./assets/images/concept.png" alt="MOSS-TTS-Nano concept" width="85%" />
</p>

MOSS-TTS-Nano 专注于 TTS 部署中最重要的部分：**小体积**、**低延迟**、**足够好的实时产品质量** 和 **简单的本地配置**。它使用纯自回归 **Audio Tokenizer + LLM** 管道，并保持推理工作流对终端用户和网络演示用户都友好。

Nano Reader 将这套运行时封装成了面向浏览器的朗读工作流。项目在其上增加了本地 Flask 服务、Chrome 扩展控制、可读段落提取、浏览器端播放管理、整理过的 prompt 音色，以及适合网页朗读的轻量级交互体验。

### 主要特性

- **本地浏览器朗读流程**：Chrome 扩展配合本地 Flask 服务
- **仅支持 CPU 推理**：与官方 `MOSS-TTS-Nano/app.py` 的 CPU 行为保持一致
- **流式优先朗读**：按段播放，首段音频返回更快
- **音色元数据映射**：弹窗中的音色分组与显示名称由 `assets/voice_browser_metadata.json` 驱动
- **预置 prompt 音色**：内置中文、英文、日文默认音色，并映射到本地参考音频
- **文本正则化开关**：浏览器端显式提供 `Enable WeTextProcessing` 和 `Enable normalize_tts_text`
- **网页友好内容提取**：保留段落中的内联超链接文本，不会把上下文拆开
- **实时解码控制**：`Realtime Streaming Decode` 默认开启；只有关闭 realtime decode 时，`Playback Speed` 才会显示并生效
- **阅读状态展示**：`Start from` 用于设置起始段落，`Now Reading` 用于展示当前正在朗读的段落内容

## 支持的语言

MOSS-TTS-Nano 目前支持 **20 种语言**：

| 语言 | 代码 | 旗帜 | 语言 | 代码 | 旗帜 | 语言 | 代码 | 旗帜 |
|---|---|---|---|---|---|---|---|---|
| 中文 | zh | 🇨🇳 | 英文 | en | 🇺🇸 | 德语 | de | 🇩🇪 |
| 西班牙语 | es | 🇪🇸 | 法语 | fr | 🇫🇷 | 日语 | ja | 🇯🇵 |
| 意大利语 | it | 🇮🇹 | 匈牙利语 | hu | 🇭🇺 | 韩语 | ko | 🇰🇷 |
| 俄语 | ru | 🇷🇺 | 波斯语 (Farsi) | fa | 🇮🇷 | 阿拉伯语 | ar | 🇸🇦 |
| 波兰语 | pl | 🇵🇱 | 葡萄牙语 | pt | 🇵🇹 | 捷克语 | cs | 🇨🇿 |
| 丹麦语 | da | 🇩🇰 | 瑞典语 | sv | 🇸🇪 | 希腊语 | el | 🇬🇷 |
| 土耳其语 | tr | 🇹🇷 |  |  |  |  |  |  |

## 快速开始

### 环境配置

建议先创建一个干净的 Python 环境，再安装 Nano Reader 服务端依赖。发布版默认目录结构要求模型仓库和权重都位于 `MOSS-TTS-Nano-Reader` 根目录下。

#### 一键安装

如果你希望用最短路径把环境装好，推荐使用这一种。

```bash
cd MOSS-TTS-Nano-Reader
conda env create -f environment.yml
conda activate nano-reader
```

这条命令会一次性安装：

- `./server` 下的本地可编辑服务端包
- `pynini`
- `WeTextProcessing`

如果后续更新了 `environment.yml`，可以用下面的命令同步环境：

```bash
conda env update -f environment.yml --prune
```

#### 分步安装

如果你希望逐步安装、或者排查某一项依赖问题，可以使用这种方式。

```bash
conda create -n nano-reader python=3.12 -y
conda activate nano-reader

cd MOSS-TTS-Nano-Reader/server
pip install -e .
```

如果你需要让弹窗中的文本规范化开关生效，而 `WeTextProcessing` 无法直接安装，可以在同一环境中继续手动安装下面这两项：

```bash
conda install -c conda-forge pynini=2.1.6.post1 -y
pip install git+https://github.com/WhizZest/WeTextProcessing.git
```

### 准备项目目录布局

Nano Reader 默认使用以下固定目录布局：

- Nano-TTS 仓库：`MOSS-TTS-Nano-Reader/MOSS-TTS-Nano`
- Checkpoint：`MOSS-TTS-Nano-Reader/models/MOSS-TTS-Nano`
- Audio tokenizer：`MOSS-TTS-Nano-Reader/models/MOSS-Audio-Tokenizer-Nano`

Nano Reader 现在通过 git submodule 管理 `MOSS-TTS-Nano`。

如果你是第一次克隆本仓库，建议直接连同 submodule 一起拉取：

```bash
git clone --recurse-submodules <你的 Nano Reader 仓库地址>
```

如果你已经克隆了 Nano Reader，但当时没有带上 submodule，可以执行：

```bash
cd MOSS-TTS-Nano-Reader
git submodule update --init --recursive
```

再把 Hugging Face 模型权重下载到默认本地目录：

```bash
mkdir -p models
huggingface-cli download OpenMOSS-Team/MOSS-TTS-Nano --local-dir models/MOSS-TTS-Nano
huggingface-cli download OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano --local-dir models/MOSS-Audio-Tokenizer-Nano
```

如果你希望使用自定义路径，启动服务时仍然可以通过 CLI 参数或环境变量覆盖默认路径。

### 启动本地 Nano Reader 服务

在 `server` 目录下运行本地 Flask 服务：

```bash
cd server
python server.py
```

默认情况下，服务会：

- 加载 `../MOSS-TTS-Nano`
- 加载 `../models/MOSS-TTS-Nano`
- 加载 `../models/MOSS-Audio-Tokenizer-Nano`
- 以 **仅 CPU** 模式运行
- 监听 `http://localhost:5050`
- 如果默认仓库目录或模型目录缺失，会直接报清晰错误并退出

使用自定义路径的示例：

```bash
python server.py \
  --nano-tts-repo-path /path/to/MOSS-TTS-Nano \
  --checkpoint-path /path/to/models/MOSS-TTS-Nano \
  --audio-tokenizer-path /path/to/models/MOSS-Audio-Tokenizer-Nano \
```

等价的环境变量启动方式：

```bash
export NANO_TTS_REPO_PATH=/path/to/MOSS-TTS-Nano
export NANO_TTS_CHECKPOINT_PATH=/path/to/models/MOSS-TTS-Nano
export NANO_TTS_AUDIO_TOKENIZER_PATH=/path/to/models/MOSS-Audio-Tokenizer-Nano
python server.py
```

### 加载 Chrome 扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开 `Developer mode`（开发者模式）
3. 点击 `Load unpacked`（加载已解压的扩展程序）
4. 选择 `MOSS-TTS-Nano-Reader/extension` 文件夹
5. 如果前端改过代码，记得重新加载扩展以刷新弹窗 UI

### 在浏览器中朗读页面

1. 确保 `server.py` 已经启动
2. 打开你要朗读的网页
3. 点击 Nano Reader 扩展图标
4. 点击 `Scan` 提取可读段落
5. 在 `Start from` 中选择起始段落
6. 在弹窗中选择音色
7. 除非你明确想关闭文本规范化，否则建议保持 `Enable WeTextProcessing` 和 `Enable normalize_tts_text` 为开启状态
8. 点击 `Read Page`

补充说明：

- `Now Reading` 用于展示当前正在朗读的段落，不会替代 `Start from`
- `Realtime Streaming Decode` 默认开启
- `Playback Speed` 只有在关闭 realtime decode 时才会显示并生效
- 弹窗中只会显示 `assets/voice_browser_metadata.json` 中声明的音色

## 致谢

- Nano Reader 构建在 OpenMOSS 团队的 **MOSS-TTS-Nano** 与 **MOSS-Audio-Tokenizer-Nano** 之上。
- 浏览器朗读器的骨架和原始交互流程改编自 [lukasmwerner/pocket-reader](https://github.com/lukasmwerner/pocket-reader.git)。感谢原作者开源该项目结构。

## MOSS-Audio-Tokenizer-Nano

<a id="mat-intro"></a>
### 介绍

**MOSS-Audio-Tokenizer** 是整个 MOSS-TTS 系列的统一离散音频接口。它基于 **Cat**（**C**ausal **A**udio **T**okenizer with **T**ransformer）架构构建，这是一个由因果 Transformer 块完全组成的无 CNN 音频分词器。它作为 MOSS-TTS、MOSS-TTS-Nano、MOSS-TTSD、MOSS-VoiceGenerator、MOSS-SoundEffect 和 MOSS-TTS-Realtime 的共享音频 tokenizer，为整个产品系列提供一致的音频表示。

为了进一步提高感知质量同时降低推理成本，我们训练了 **MOSS-Audio-Tokenizer-Nano**，这是一个轻量级分词器，包含约 **2000 万参数**，专为高保真音频压缩设计。它支持 **48 kHz** 输入输出以及 **立体声音频**，有助于减少压缩损失并提高听觉质量。它可以将 **48 kHz 立体声音频** 压缩成 **12.5 Hz** 的 token 流，使用 **带有 16 个码本的 RVQ**，在 **0.125 kbps 到 4 kbps** 的可变码率范围内实现高保真重建。

要了解更多关于设置、高级用法和评估指标的信息，请访问 [MOSS-Audio-Tokenizer 仓库](https://github.com/OpenMOSS/MOSS-Audio-Tokenizer)

<p align="center">
  <img src="./assets/images/arch_moss_audio_tokenizer_nano.png" alt="MOSS-Audio-Tokenizer-Nano 架构" width="100%" />
  MOSS-Audio-Tokenizer-Nano 架构
</p>

### 模型权重

| 模型 | Hugging Face | ModelScope |
|:-----:|:------------:|:----------:|
| **MOSS-Audio-Tokenizer-Nano** | [![Hugging Face](https://img.shields.io/badge/Huggingface-Model-orange?logo=huggingface)](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano) | [![ModelScope](https://img.shields.io/badge/ModelScope-Model-lightgrey?logo=modelscope)](https://modelscope.cn/models/openmoss/MOSS-Audio-Tokenizer-Nano) |

## 许可证

本仓库将遵循根目录中的 `LICENSE` 文件中指定的许可证。如果您在该文件发布前阅读本文档，请将本仓库视为 **未获得重新发布许可**。

## 引用

如果您在研究或产品中使用了 MOSS-TTS 工作，请引用：

```bibtex
@misc{openmoss2026mossttsnano,
  title={MOSS-TTS-Nano},
  author={OpenMOSS Team},
  year={2026},
  howpublished={GitHub repository},
  url={https://github.com/OpenMOSS/MOSS-TTS-Nano}
}
```

```bibtex
@misc{gong2026mossttstechnicalreport,
  title={MOSS-TTS Technical Report},
  author={Yitian Gong and Botian Jiang and Yiwei Zhao and Yucheng Yuan and Kuangwei Chen and Yaozhou Jiang and Cheng Chang and Dong Hong and Mingshu Chen and Ruixiao Li and Yiyang Zhang and Yang Gao and Hanfu Chen and Ke Chen and Songlin Wang and Xiaogui Yang and Yuqian Zhang and Kexin Huang and ZhengYuan Lin and Kang Yu and Ziqi Chen and Jin Wang and Zhaoye Fei and Qinyuan Cheng and Shimin Li and Xipeng Qiu},
  year={2026},
  eprint={2603.18090},
  archivePrefix={arXiv},
  primaryClass={cs.SD},
  url={https://arxiv.org/abs/2603.18090}
}
```

```bibtex
@misc{gong2026mossaudiotokenizerscalingaudiotokenizers,
  title={MOSS-Audio-Tokenizer: Scaling Audio Tokenizers for Future Audio Foundation Models},
  author={Yitian Gong and Kuangwei Chen and Zhaoye Fei and Xiaogui Yang and Ke Chen and Yang Wang and Kexin Huang and Mingshu Chen and Ruixiao Li and Qingyuan Cheng and Shimin Li and Xipeng Qiu},
  year={2026},
  eprint={2602.10934},
  archivePrefix={arXiv},
  primaryClass={cs.SD},
  url={https://arxiv.org/abs/2602.10934}
}
```

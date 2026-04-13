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

Nano Reader is a local browser reading application built on [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano). It combines a Chrome extension, a local Flask server, curated prompt-voice metadata, and CPU-friendly streaming inference so web pages can be read aloud directly on your own machine.

## News

* 2026.4.13: We release **Nano Reader**, a browser-focused local reading integration on top of **MOSS-TTS-Nano**.
* 2026.4.10: We release **MOSS-TTS-Nano**. A demo Space is available at [OpenMOSS-Team/MOSS-TTS-Nano](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-TTS-Nano). You can also view the demo and more details at [openmoss.github.io/MOSS-TTS-Nano-Demo/](https://openmoss.github.io/MOSS-TTS-Nano-Demo/).

## Demo

![Nano Reader demo](./images/demo.png)

- Online Demo: [https://openmoss.github.io/MOSS-TTS-Nano-Demo/](https://openmoss.github.io/MOSS-TTS-Nano-Demo/)
- Hugging Face Space: [OpenMOSS-Team/MOSS-TTS-Nano](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-TTS-Nano)

## Contents

- [News](#news)
- [Demo](#demo)
- [Introduction](#introduction)
  - [Main Features](#main-features)
- [Supported Languages](#supported-languages)
- [Quickstart](#quickstart)
  - [Environment Setup](#environment-setup)
  - [Prepare The Project Layout](#prepare-the-project-layout)
  - [Start The Local Nano Reader Server](#start-the-local-nano-reader-server)
  - [Load The Chrome Extension](#load-the-chrome-extension)
  - [Read A Page In The Browser](#read-a-page-in-the-browser)
- [Acknowledgements](#acknowledgements)
- [MOSS-Audio-Tokenizer-Nano](#moss-audio-tokenizer-nano)
- [License](#license)
- [Citation](#citation)

## Introduction

<p align="center">
  <img src="./assets/images/concept.png" alt="MOSS-TTS-Nano concept" width="85%" />
</p>

MOSS-TTS-Nano focuses on the part of TTS deployment that matters most in practice: **small footprint**, **low latency**, **good enough quality for realtime products**, and **simple local setup**. It uses a pure autoregressive **Audio Tokenizer + LLM** pipeline and keeps the inference workflow friendly for both terminal users and web-demo users.

Nano Reader packages that runtime into a browser-first workflow. The project adds a local Flask server, Chrome extension controls, readable-paragraph extraction, browser-side playback management, curated prompt voices, and a lightweight reading UX for page-by-page or paragraph-by-paragraph listening.

### Main Features

- **Local browser reading flow**: Chrome extension plus local Flask server
- **CPU-only inference**: aligned with the official `MOSS-TTS-Nano/app.py` CPU behavior
- **Streaming-first reading**: paragraph-by-paragraph playback for fast first audio
- **Voice browser metadata**: popup voice groups and names are driven by `assets/voice_browser_metadata.json`
- **Prompt-voice presets**: built-in Chinese, English, and Japanese voices mapped to local prompt audio
- **Text normalization toggles**: explicit browser-side switches for `Enable WeTextProcessing` and `Enable normalize_tts_text`
- **Webpage-friendly extraction**: keeps inline hyperlink text inside the surrounding paragraph instead of splitting it apart
- **Realtime decode controls**: `Realtime Streaming Decode` is enabled by default; `Playback Speed` is only shown and applied when realtime decode is disabled
- **Reading state UI**: `Start from` controls the initial paragraph and `Now Reading` shows the active paragraph text

## Supported Languages

MOSS-TTS-Nano currently supports **20 languages**:

| Language | Code | Flag | Language | Code | Flag | Language | Code | Flag |
|---|---|---|---|---|---|---|---|---|
| Chinese | zh | 🇨🇳 | English | en | 🇺🇸 | German | de | 🇩🇪 |
| Spanish | es | 🇪🇸 | French | fr | 🇫🇷 | Japanese | ja | 🇯🇵 |
| Italian | it | 🇮🇹 | Hungarian | hu | 🇭🇺 | Korean | ko | 🇰🇷 |
| Russian | ru | 🇷🇺 | Persian (Farsi) | fa | 🇮🇷 | Arabic | ar | 🇸🇦 |
| Polish | pl | 🇵🇱 | Portuguese | pt | 🇵🇹 | Czech | cs | 🇨🇿 |
| Danish | da | 🇩🇰 | Swedish | sv | 🇸🇪 | Greek | el | 🇬🇷 |
| Turkish | tr | 🇹🇷 |  |  |  |  |  |  |

## Quickstart

### Environment Setup

We recommend a clean Python environment first, then installing the Nano Reader server dependencies locally. The default release layout expects the repository checkout and model snapshots to live inside the `pocket-reader` root.

#### Using Conda

```bash
conda create -n nano-reader python=3.12 -y
conda activate nano-reader

cd pocket-reader/server
pip install -e .
```

If `WeTextProcessing` is needed for the popup normalization switches and fails to install directly, try installing it manually in the same environment:

```bash
conda install -c conda-forge pynini=2.1.6.post1 -y
pip install git+https://github.com/WhizZest/WeTextProcessing.git
```

### Prepare The Project Layout

Nano Reader defaults to the following fixed layout:

- Nano-TTS repo: `pocket-reader/MOSS-TTS-Nano`
- Checkpoint: `pocket-reader/models/MOSS-TTS-Nano`
- Audio tokenizer: `pocket-reader/models/MOSS-Audio-Tokenizer-Nano`

Clone the official Nano-TTS repository into the project root:

```bash
cd pocket-reader
git clone https://github.com/OpenMOSS/MOSS-TTS-Nano.git
```

Download model weights from Hugging Face into the default local directories:

```bash
mkdir -p models
huggingface-cli download OpenMOSS-Team/MOSS-TTS-Nano --local-dir models/MOSS-TTS-Nano
huggingface-cli download OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano --local-dir models/MOSS-Audio-Tokenizer-Nano
```

If you prefer custom paths, you can still override the defaults with CLI arguments or environment variables when starting the server.

### Start The Local Nano Reader Server

Run the local Flask server from the `server` directory:

```bash
cd pocket-reader/server
python server.py
```

By default, the server will:

- load `../MOSS-TTS-Nano`
- load `../models/MOSS-TTS-Nano`
- load `../models/MOSS-Audio-Tokenizer-Nano`
- run in **CPU-only** mode
- listen on `http://localhost:5050`
- exit early with a clear error if the default repo or model directories are missing

Optional custom-path launch:

```bash
python server.py \
  --nano-tts-repo-path /path/to/MOSS-TTS-Nano \
  --checkpoint-path /path/to/models/MOSS-TTS-Nano \
  --audio-tokenizer-path /path/to/models/MOSS-Audio-Tokenizer-Nano \
  --attn-implementation eager
```

Equivalent environment-variable launch:

```bash
export NANO_TTS_REPO_PATH=/path/to/MOSS-TTS-Nano
export NANO_TTS_CHECKPOINT_PATH=/path/to/models/MOSS-TTS-Nano
export NANO_TTS_AUDIO_TOKENIZER_PATH=/path/to/models/MOSS-Audio-Tokenizer-Nano
python server.py
```

### Load The Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `pocket-reader/extension` folder
5. Reload the extension after frontend changes so popup UI updates take effect

### Read A Page In The Browser

1. Make sure `server.py` is already running
2. Open a webpage you want to read
3. Click the Nano Reader extension icon
4. Click `Scan` to extract readable paragraphs
5. Choose the start paragraph from `Start from`
6. Select a voice from the popup
7. Keep `Enable WeTextProcessing` and `Enable normalize_tts_text` enabled unless you explicitly want raw text
8. Click `Read Page`

Useful notes:

- `Now Reading` shows the currently active paragraph and does not replace the `Start from` selector
- `Realtime Streaming Decode` is enabled by default
- `Playback Speed` is only visible and effective when realtime decode is disabled
- The popup only shows voices declared in `assets/voice_browser_metadata.json`

## Acknowledgements

- Nano Reader is built on top of **MOSS-TTS-Nano** and **MOSS-Audio-Tokenizer-Nano** from the OpenMOSS team.
- The browser-reader skeleton and original interaction flow were adapted from [lukasmwerner/pocket-reader](https://github.com/lukasmwerner/pocket-reader.git). We thank the original author for open-sourcing that project structure.

## MOSS-Audio-Tokenizer-Nano

<a id="mat-intro"></a>
### Introduction
**MOSS-Audio-Tokenizer** is the unified discrete audio interface for the entire MOSS-TTS family. It is built on the **Cat** (**C**ausal **A**udio **T**okenizer with **T**ransformer) architecture, a CNN-free audio tokenizer composed entirely of causal Transformer blocks. It serves as the shared audio backbone for MOSS-TTS, MOSS-TTS-Nano, MOSS-TTSD, MOSS-VoiceGenerator, MOSS-SoundEffect, and MOSS-TTS-Realtime, providing a consistent audio representation across the full product family.

To further improve perceptual quality while reducing inference cost, we trained **MOSS-Audio-Tokenizer-Nano**, a lightweight tokenizer with approximately **20 million parameters** designed for high-fidelity audio compression. It supports **48 kHz** input and output as well as **stereo audio**, which helps reduce compression loss and improve listening quality. It can compress **48 kHz stereo audio** into a **12.5 Hz** token stream and uses **RVQ with 16 codebooks**, enabling high-fidelity reconstruction across variable bitrates from **0.125 kbps to 4 kbps**.


To learn more about setup, advanced usage, and evaluation metrics, please visit the [MOSS-Audio-Tokenizer Repository](https://github.com/OpenMOSS/MOSS-Audio-Tokenizer)

<p align="center">
  <img src="./assets/images/arch_moss_audio_tokenizer_nano.png" alt="MOSS-Audio-Tokenizer-Nano architecture" width="100%" />
  Architecture of MOSS-Audio-Tokenizer-Nano
</p>

### Model Weights

| Model | Hugging Face | ModelScope |
|:-----:|:------------:|:----------:|
| **MOSS-Audio-Tokenizer-Nano** | [![Hugging Face](https://img.shields.io/badge/Huggingface-Model-orange?logo=huggingface)](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano) | [![ModelScope](https://img.shields.io/badge/ModelScope-Model-lightgrey?logo=modelscope)](https://modelscope.cn/models/openmoss/MOSS-Audio-Tokenizer-Nano) |


## License

This repository will follow the license specified in the root `LICENSE` file. If you are reading this before that file is published, please treat the repository as **not yet licensed for redistribution**.

## Citation

If you use the MOSS-TTS work in your research or product, please cite:

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

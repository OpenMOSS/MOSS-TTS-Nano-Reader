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

MOSS-TTS-Nano Reader is a local browser webpage reading application built on [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano).

## News

* 2026.4.14: We release **Nano Reader**, a browser-focused local reading integration on top of **MOSS-TTS-Nano**.
* 2026.4.10: We release **MOSS-TTS-Nano**. A demo Space is available at [OpenMOSS-Team/MOSS-TTS-Nano](https://huggingface.co/spaces/OpenMOSS-Team/MOSS-TTS-Nano). You can also view the demo and more details at [openmoss.github.io/MOSS-TTS-Nano-Demo/](https://openmoss.github.io/MOSS-TTS-Nano-Demo/).

## Quick Install

Thanks to the efficient performance improvements of the newly released ONNX version of [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano), we can now migrate the whole project and model stack directly into the browser, removing the need to start an extra local service.

Here is a quick usage overview:

1. Load `MOSS-TTS-Nano-Reader/extension` directly as the browser extension.
2. It is recommended to pre-download [MOSS-Audio-Tokenizer-Nano-ONNX](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX) and [MOSS-TTS-Nano-100M-ONNX](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX) into `MOSS-TTS-Nano-Reader\extension_test\models`.
3. If the models are not prepared yet, open the extension's Browser ONNX PoC and click `Load And Prepare` to start downloading automatically.
4. Once loading succeeds, the extension is ready to use.

## Contents

- [News](#news)
- [Quick Install](#quick-install)
- [Introduction](#introduction)
  - [Main Features](#main-features)
- [Supported Languages](#supported-languages)
- [Quickstart](#quickstart)
  - [Get The Repository](#get-the-repository)
  - [Environment Setup](#environment-setup)
  - [Prepare The Project Layout](#prepare-the-project-layout)
  - [Start Nano Reader Locally](#start-nano-reader-locally)
    - [Start The Desktop Reader App](#start-the-desktop-reader-app)
    - [Start The Command-Line Nano Reader Service](#start-the-command-line-nano-reader-service)
  - [Load The Chrome Extension](#load-the-chrome-extension)
  - [Read A Page In The Browser](#read-a-page-in-the-browser)
- [Usage Notes](#usage-notes)
- [Acknowledgements](#acknowledgements)
- [License](#license)
- [Citation](#citation)

## Introduction

<p align="center">
  <img src="./assets/images/concept.png" alt="MOSS-TTS-Nano concept" width="85%" />
</p>

Nano Reader is a lightweight browser reading tool built on top of `MOSS-TTS-Nano`. It focuses on low-latency local webpage reading with a simple extension + local server workflow.

### Main Features

- **Ultra-low-latency webpage reading**
- **Pure CPU inference**
- **Chrome / Edge extension support**
- **Freely add custom voices**

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

The recommended workflow is: start a local Nano Reader inference service first, either with `reader-app` or the command-line service, and then use the browser extension directly for webpage playback. We also plan to provide ready-to-use packaged builds through [Releases](https://github.com/OpenMOSS/MOSS-TTS-Nano-Reader/releases) so they can work out of the box together with the browser extension.

### Get The Repository

Nano Reader now tracks `MOSS-TTS-Nano` as a git submodule.

For a fresh clone of this repository, clone it with submodules:

```bash
git clone --recurse-submodules https://github.com/OpenMOSS/MOSS-TTS-Nano-Reader.git
```

If you already cloned Nano Reader without submodules, initialize and fetch them with:

```bash
cd MOSS-TTS-Nano-Reader
git submodule update --init --recursive
```

### Environment Setup

We recommend a clean Python environment first, then installing the Nano Reader server dependencies locally. The default release layout expects the repository checkout and model snapshots to live inside the `MOSS-TTS-Nano-Reader` root.

#### One-Command Installation

Use this if you want the shortest setup path.

```bash
cd MOSS-TTS-Nano-Reader
conda env create -f environment.yml
conda activate nano-reader
```

This single command installs:

- the editable local server package from `./server`
- `pynini`
- `WeTextProcessing`

If you later update `environment.yml`, refresh the environment with:

```bash
cd MOSS-TTS-Nano-Reader
conda env update -f environment.yml --prune
```

#### Step-by-Step Installation

Use this if you prefer to install each dependency manually or need to troubleshoot one part at a time.

```bash
conda create -n nano-reader python=3.12 -y
conda activate nano-reader

cd MOSS-TTS-Nano-Reader/server
pip install -e .
```

If `WeTextProcessing` is needed for the popup normalization switches and fails to install directly, install its extra dependencies in the same environment:

```bash
conda install -c conda-forge pynini=2.1.6.post1 -y
pip install git+https://github.com/WhizZest/WeTextProcessing.git
```

### Prepare The Project Layout

Nano Reader defaults to the following fixed layout:

- Nano-TTS repo: `MOSS-TTS-Nano-Reader/MOSS-TTS-Nano`
- Checkpoint: `MOSS-TTS-Nano-Reader/models/MOSS-TTS-Nano`
- Audio tokenizer: `MOSS-TTS-Nano-Reader/models/MOSS-Audio-Tokenizer-Nano`

Download model weights from Hugging Face into the default local directories:

```bash
mkdir -p models
huggingface-cli download OpenMOSS-Team/MOSS-TTS-Nano --local-dir models/MOSS-TTS-Nano
huggingface-cli download OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano --local-dir models/MOSS-Audio-Tokenizer-Nano
```

If you prefer custom paths, you can still override the defaults with CLI arguments or environment variables when starting the server.

### Start Nano Reader Locally

#### Start The Desktop Reader App

Use `reader-app` if you want a desktop window to start and manage the local service:

```bash
cd MOSS-TTS-Nano-Reader
python reader-app/main.py
```

The current `reader-app` can:

- start, stop, and restart the local server
- show live startup and runtime logs
- change `Server Port`
- set `Checkpoint Path` and `Audio Tokenizer Path` to load models from specific paths

A packaged `reader-app` build for supported platforms can be downloaded from [Releases](https://github.com/OpenMOSS/MOSS-TTS-Nano-Reader/releases). Reader App automatically downloads model weights to the default paths.

If you use a non-default port in `reader-app`, update the same host and port in the extension popup under `Server Connection`.

#### Start The Command-Line Nano Reader Service

Use this mode if you prefer to run the local Flask server directly from the command line:

```bash
cd MOSS-TTS-Nano-Reader/server
python server.py
```

By default, the server will:

- load `../MOSS-TTS-Nano`
- load `../models/MOSS-TTS-Nano`
- load `../models/MOSS-Audio-Tokenizer-Nano`
- run in **CPU-only** mode
- listen on `http://localhost:5050`
- exit early with a clear error if the default repo or model directories are missing

Use a different port:

```bash
python server.py --port 6060
```

Equivalent environment-variable launch:

```bash
export NANO_TTS_PORT=6060
python server.py
```

Important:

- The browser extension uses `http://localhost:5050` by default
- If you change the port, open the extension popup, expand `Server Connection`, set the same host and port, then click `Apply`

Optional custom-path launch:

```bash
python server.py \
  --nano-tts-repo-path /path/to/MOSS-TTS-Nano \
  --checkpoint-path /path/to/models/MOSS-TTS-Nano \
  --audio-tokenizer-path /path/to/models/MOSS-Audio-Tokenizer-Nano \
```

Equivalent environment-variable launch for custom model paths:

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
4. Select the `MOSS-TTS-Nano-Reader/extension` folder

### Read A Page In The Browser

1. Make sure `server.py` or `reader-app` is already running
2. Open a webpage you want to read
3. Click the Nano Reader extension icon
4. Click `Scan` to extract readable paragraphs
5. Choose the start paragraph from `Start from`
6. Select a voice from the popup
7. If needed, expand `Server Connection` and confirm the host and port match the running local service
8. Keep `Enable WeTextProcessing` and `Enable normalize_tts_text` enabled unless you explicitly want raw text
9. Click `Read Page`

## Usage Notes

- After the server starts, you can check whether it is ready through `/health`, for example `http://localhost:5050/health` by default.
- `Realtime Streaming Decode` is enabled by default for low-latency playback. If you turn it off, the extension waits until the full audio segment is generated before playback starts.
- If playback feels choppy, try increasing `CPU Threads`, or close other CPU-heavy programs.
- `Initial Playback Delay (s)` controls how long the player waits before starting the first audio frame. A slightly larger value lets the model generate more audio before playback begins.
- `Enable WeTextProcessing` enables WeTextProcessing-based text normalization. If some symbols are spoken in an unexpected way, try turning it off.
- You can use `Add Voice` to add custom voices. Added voices remain in the selector until you remove their entries from `assets/voice_browser_metadata.json`.

## Acknowledgements

- Nano Reader is built on top of [**MOSS-TTS-Nano**](https://github.com/OpenMOSS/MOSS-TTS-Nano) and [**MOSS-Audio-Tokenizer-Nano**](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano) from the OpenMOSS team.
- The browser-reader skeleton and original interaction flow were adapted from [lukasmwerner/pocket-reader](https://github.com/lukasmwerner/pocket-reader.git). We thank the original author for open-sourcing that project structure.

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

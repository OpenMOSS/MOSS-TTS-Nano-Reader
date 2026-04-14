"""
Nano Reader TTS Server

A Flask server that uses Nano-TTS to convert text to speech.
Supports streaming audio and preset prompt voices.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import re
import sys
import threading
import unicodedata
import uuid
import wave
from pathlib import Path
from typing import Callable, Iterator, TypeVar

import numpy as np
import torch
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

SERVER_DIR = Path(__file__).resolve().parent
POCKET_READER_DIR = SERVER_DIR.parent
DEFAULT_NANO_TTS_REPO_DIR = (POCKET_READER_DIR / "MOSS-TTS-Nano").resolve()
DEFAULT_MODELS_DIR = (POCKET_READER_DIR / "models").resolve()
DEFAULT_LOCAL_CHECKPOINT_PATH = (DEFAULT_MODELS_DIR / "MOSS-TTS-Nano").resolve()
DEFAULT_LOCAL_AUDIO_TOKENIZER_PATH = (DEFAULT_MODELS_DIR / "MOSS-Audio-Tokenizer-Nano").resolve()
LOCAL_VOICE_ASSETS_DIR = POCKET_READER_DIR / "assets" / "audio"
VOICE_BROWSER_METADATA_PATH = POCKET_READER_DIR / "assets" / "voice_browser_metadata.json"
VOICE_METADATA_LOCK = threading.Lock()
ALLOWED_LOCAL_VOICE_AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
DEFAULT_CHECKPOINT_REPO_ID = "OpenMOSS-Team/MOSS-TTS-Nano"
DEFAULT_AUDIO_TOKENIZER_REPO_ID = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano"


def _read_cli_option(flag_names: tuple[str, ...]) -> str | None:
    argv = sys.argv[1:]
    for index, item in enumerate(argv):
        for flag_name in flag_names:
            if item == flag_name and index + 1 < len(argv):
                return argv[index + 1]
            prefix = f"{flag_name}="
            if item.startswith(prefix):
                return item[len(prefix) :]
    return None


def _resolve_repo_dir() -> Path:
    raw_value = (
        _read_cli_option(("--nano-tts-repo-path", "--nano_tts_repo_path"))
        or os.getenv("NANO_TTS_REPO_PATH", "").strip()
    )
    if raw_value:
        return Path(raw_value).expanduser().resolve()
    return DEFAULT_NANO_TTS_REPO_DIR


def _resolve_model_source(
    *,
    env_key: str,
    default_local_path: Path,
) -> str:
    raw_value = os.getenv(env_key, "").strip()
    if raw_value:
        return raw_value
    return str(default_local_path)


def _exit_with_layout_error(message: str) -> None:
    raise SystemExit(message)


def _require_repo_checkout(repo_dir: Path) -> None:
    if not repo_dir.is_dir():
        _exit_with_layout_error(
            f"Missing Nano-TTS repo: {repo_dir}\n"
            "Expected the default release layout under pocket-reader/MOSS-TTS-Nano, "
            "or set NANO_TTS_REPO_PATH / --nano-tts-repo-path explicitly."
        )

    required_files = [
        repo_dir / "moss_tts_nano_runtime.py",
        repo_dir / "text_normalization_pipeline.py",
    ]
    missing_files = [str(path) for path in required_files if not path.is_file()]
    if missing_files:
        _exit_with_layout_error(
            "Invalid Nano-TTS repo checkout. Missing required files:\n"
            + "\n".join(missing_files)
        )


def _model_dir_looks_ready(
    path: Path,
    *,
    required_files: tuple[str, ...],
    required_any_files: tuple[str, ...],
) -> bool:
    if not path.is_dir():
        return False
    for relative_path in required_files:
        if not (path / relative_path).exists():
            return False
    return any((path / relative_path).exists() for relative_path in required_any_files)


def _ensure_default_model_dir(
    path: Path,
    *,
    label: str,
    repo_id: str,
    required_files: tuple[str, ...],
    required_any_files: tuple[str, ...],
    flag_names: tuple[str, ...],
    env_key: str,
) -> None:
    if _model_dir_looks_ready(path, required_files=required_files, required_any_files=required_any_files):
        return
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        flags_text = " / ".join(flag_names)
        _exit_with_layout_error(
            f"Missing default {label}: {path}\n"
            f"Automatic download requires huggingface_hub. install_error={exc}\n"
            f"Or pass {flags_text} / {env_key} explicitly."
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    logging.info(
        "Missing default %s at %s. Downloading %s from Hugging Face. This may take a while...",
        label,
        path,
        repo_id,
    )
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(path),
    )
    if not _model_dir_looks_ready(path, required_files=required_files, required_any_files=required_any_files):
        flags_text = " / ".join(flag_names)
        _exit_with_layout_error(
            f"Downloaded {label} to {path}, but required files are still missing.\n"
            f"Please verify the local directory, or pass {flags_text} / {env_key} explicitly."
        )
    logging.info("Finished downloading %s to %s", label, path)


NANO_TTS_REPO_DIR = _resolve_repo_dir()
_require_repo_checkout(NANO_TTS_REPO_DIR)
DEMO_METADATA_PATH = NANO_TTS_REPO_DIR / "assets" / "demo.jsonl"

if str(NANO_TTS_REPO_DIR) not in sys.path:
    sys.path.insert(0, str(NANO_TTS_REPO_DIR))

from moss_tts_nano_runtime import (  # noqa: E402
    DEFAULT_VOICE,
    NanoTTSService,
    VoicePreset,
    build_default_voice_presets,
)
from text_normalization_pipeline import (  # noqa: E402
    TextNormalizationSnapshot,
    WeTextProcessingManager,
    prepare_tts_request_texts,
)

app = Flask(__name__)
CORS(app)

CHECKPOINT_PATH = _resolve_model_source(
    env_key="NANO_TTS_CHECKPOINT_PATH",
    default_local_path=DEFAULT_LOCAL_CHECKPOINT_PATH,
)
AUDIO_TOKENIZER_PATH = _resolve_model_source(
    env_key="NANO_TTS_AUDIO_TOKENIZER_PATH",
    default_local_path=DEFAULT_LOCAL_AUDIO_TOKENIZER_PATH,
)
OUTPUT_DIR = Path(os.getenv("NANO_TTS_OUTPUT_DIR", str(POCKET_READER_DIR / "generated_audio"))).expanduser()
REQUESTED_DEVICE = os.getenv("NANO_TTS_DEVICE", "cpu")
DEVICE = "cpu"
DTYPE = os.getenv("NANO_TTS_DTYPE", "auto")
ATTN_IMPLEMENTATION = os.getenv("NANO_TTS_ATTN_IMPLEMENTATION", "auto")
MAX_NEW_FRAMES = int(os.getenv("NANO_TTS_MAX_NEW_FRAMES", "375"))
VOICE_CLONE_MAX_TEXT_TOKENS = int(os.getenv("NANO_TTS_VOICE_CLONE_MAX_TEXT_TOKENS", "100"))
DEFAULT_CPU_THREADS = int(os.getenv("NANO_TTS_DEFAULT_CPU_THREADS", "4"))
DEFAULT_TTS_MAX_BATCH_SIZE = int(os.getenv("NANO_TTS_DEFAULT_TTS_MAX_BATCH_SIZE", "1"))
STREAM_AUDIO_SAMPLE_RATE = int(os.getenv("NANO_TTS_STREAM_SAMPLE_RATE", "48000"))
STREAM_AUDIO_CHANNELS = int(os.getenv("NANO_TTS_STREAM_CHANNELS", "2"))
DEFAULT_ENABLE_TEXT_NORMALIZATION = os.getenv("NANO_TTS_ENABLE_TEXT_NORMALIZATION", "1")
DEFAULT_ENABLE_ROBUST_TEXT_NORMALIZATION = os.getenv("NANO_TTS_ENABLE_ROBUST_TEXT_NORMALIZATION", "1")

_tts_runtime: NanoTTSService | None = None
_runtime_manager: "RequestRuntimeManager | None" = None
_text_normalizer_manager: WeTextProcessingManager | None = None
T = TypeVar("T")

SMART_QUOTE_MAP = str.maketrans(
    {
        "\u201c": '"',
        "\u201d": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u201e": '"',
        "\u201f": '"',
        "\u2032": "'",
        "\u2033": '"',
    }
)


def get_runtime() -> NanoTTSService:
    global _tts_runtime
    if _tts_runtime is None:
        logging.info(
            "Loading Nano-TTS runtime checkpoint=%s audio_tokenizer=%s device=%s dtype=%s attn=%s",
            CHECKPOINT_PATH,
            AUDIO_TOKENIZER_PATH,
            DEVICE,
            DTYPE,
            ATTN_IMPLEMENTATION,
        )
        _tts_runtime = NanoTTSService(
            checkpoint_path=CHECKPOINT_PATH,
            audio_tokenizer_path=AUDIO_TOKENIZER_PATH,
            device=DEVICE,
            dtype=DTYPE,
            attn_implementation=ATTN_IMPLEMENTATION,
            output_dir=OUTPUT_DIR,
            voice_presets=build_pocket_reader_voice_presets(),
        )
    return _tts_runtime


class RequestRuntimeManager:
    def __init__(self, default_runtime: NanoTTSService) -> None:
        self.default_runtime = default_runtime
        self.default_cpu_threads = max(1, DEFAULT_CPU_THREADS)
        self._lock = threading.Lock()
        self._cpu_execution_lock = threading.Lock()
        self._cpu_runtime: NanoTTSService | None = None

    @staticmethod
    def normalize_requested_execution_device(requested: str | None) -> str:
        return "cpu"

    def is_cpu_runtime_loaded(self) -> bool:
        with self._lock:
            return self._cpu_runtime is not None

    def refresh_voice_presets(self, voice_presets: dict[str, VoicePreset]) -> None:
        with self._lock:
            _replace_runtime_voice_presets(self.default_runtime, voice_presets)
            if self._cpu_runtime is not None and self._cpu_runtime.voice_presets is not self.default_runtime.voice_presets:
                _replace_runtime_voice_presets(self._cpu_runtime, voice_presets)

    def _build_cpu_runtime_locked(self) -> NanoTTSService:
        if self._cpu_runtime is not None:
            return self._cpu_runtime
        self._cpu_runtime = NanoTTSService(
            checkpoint_path=self.default_runtime.checkpoint_path,
            audio_tokenizer_path=self.default_runtime.audio_tokenizer_path,
            device="cpu",
            dtype="float32",
            attn_implementation=self.default_runtime.attn_implementation or "auto",
            output_dir=self.default_runtime.output_dir,
            voice_presets=self.default_runtime.voice_presets,
        )
        return self._cpu_runtime

    def resolve_runtime(self, requested: str | None) -> tuple[NanoTTSService, str]:
        normalized = self.normalize_requested_execution_device(requested)
        if normalized != "cpu":
            return self.default_runtime, str(self.default_runtime.device.type)
        if self.default_runtime.device.type == "cpu":
            return self.default_runtime, "cpu"
        with self._lock:
            return self._build_cpu_runtime_locked(), "cpu"

    def _resolve_cpu_threads(self, cpu_threads: int | None) -> int:
        if cpu_threads is None:
            return self.default_cpu_threads
        try:
            normalized_threads = int(cpu_threads)
        except Exception:
            return self.default_cpu_threads
        if normalized_threads <= 0:
            return self.default_cpu_threads
        return max(1, normalized_threads)

    def call_with_runtime(
        self,
        *,
        requested_execution_device: str | None,
        cpu_threads: int | None,
        callback: Callable[[NanoTTSService], T],
    ) -> tuple[T, str, int | None]:
        runtime, execution_device = self.resolve_runtime(requested_execution_device)
        if runtime.device.type != "cpu":
            return callback(runtime), execution_device, None

        resolved_cpu_threads = self._resolve_cpu_threads(cpu_threads)
        with self._cpu_execution_lock:
            previous_threads = torch.get_num_threads()
            threads_changed = previous_threads != resolved_cpu_threads
            if threads_changed:
                torch.set_num_threads(resolved_cpu_threads)
            try:
                return callback(runtime), execution_device, resolved_cpu_threads
            finally:
                if threads_changed:
                    torch.set_num_threads(previous_threads)

    def iter_with_runtime(
        self,
        *,
        requested_execution_device: str | None,
        cpu_threads: int | None,
        factory: Callable[[NanoTTSService], Iterator[T]],
    ) -> Iterator[tuple[T, str, int | None]]:
        runtime, execution_device = self.resolve_runtime(requested_execution_device)
        if runtime.device.type != "cpu":
            for item in factory(runtime):
                yield item, execution_device, None
            return

        resolved_cpu_threads = self._resolve_cpu_threads(cpu_threads)
        with self._cpu_execution_lock:
            previous_threads = torch.get_num_threads()
            threads_changed = previous_threads != resolved_cpu_threads
            if threads_changed:
                torch.set_num_threads(resolved_cpu_threads)
            try:
                for item in factory(runtime):
                    yield item, execution_device, resolved_cpu_threads
            finally:
                if threads_changed:
                    torch.set_num_threads(previous_threads)


def get_runtime_manager() -> RequestRuntimeManager:
    global _runtime_manager
    if _runtime_manager is None:
        _runtime_manager = RequestRuntimeManager(get_runtime())
    return _runtime_manager


def get_text_normalizer_manager() -> WeTextProcessingManager:
    global _text_normalizer_manager
    if _text_normalizer_manager is None:
        _text_normalizer_manager = WeTextProcessingManager()
        _text_normalizer_manager.start()
    return _text_normalizer_manager


def _sanitize_demo_voice_name(raw_name: object, fallback: str) -> str:
    cleaned = re.sub(r"^[^\w]+", "", str(raw_name or "")).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def _normalize_metadata_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _normalize_uploaded_display_name(value: object) -> str:
    cleaned = _normalize_metadata_text(value)
    if not cleaned:
        raise ValueError("Display name is required.")
    if len(cleaned) > 80:
        raise ValueError("Display name must be 80 characters or fewer.")
    return cleaned


def _normalize_uploaded_voice_group(value: object) -> str:
    cleaned = _normalize_metadata_text(value)
    if not cleaned:
        raise ValueError("Group is required.")
    if len(cleaned) > 80:
        raise ValueError("Group must be 80 characters or fewer.")
    return cleaned


def _normalize_browser_metadata_row(row: object) -> dict[str, str] | None:
    if not isinstance(row, dict):
        return None
    voice_name = _normalize_metadata_text(row.get("voice"))
    if not voice_name:
        return None
    return {
        "voice": voice_name,
        "display_name": _normalize_metadata_text(row.get("display_name")) or voice_name,
        "group": _normalize_metadata_text(row.get("group")),
        "audio_file": Path(str(row.get("audio_file") or "")).name.strip(),
    }


def load_voice_browser_metadata() -> list[dict[str, str]]:
    if not VOICE_BROWSER_METADATA_PATH.is_file():
        return []

    try:
        payload = json.loads(VOICE_BROWSER_METADATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        logging.warning("Failed to read voice browser metadata: %s", VOICE_BROWSER_METADATA_PATH, exc_info=True)
        return []

    if not isinstance(payload, list):
        logging.warning("Voice browser metadata must be a list: %s", VOICE_BROWSER_METADATA_PATH)
        return []

    result: list[dict[str, str]] = []
    seen_voice_names: set[str] = set()
    for row in payload:
        normalized_row = _normalize_browser_metadata_row(row)
        if normalized_row is None:
            continue
        voice_key = normalized_row["voice"].casefold()
        if voice_key in seen_voice_names:
            logging.warning("Skipping duplicate browser voice metadata entry: %s", normalized_row["voice"])
            continue
        seen_voice_names.add(voice_key)
        result.append(normalized_row)
    return result


def save_voice_browser_metadata(rows: list[dict[str, str]]) -> None:
    normalized_rows = [normalized_row for row in rows if (normalized_row := _normalize_browser_metadata_row(row)) is not None]
    VOICE_BROWSER_METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    VOICE_BROWSER_METADATA_PATH.write_text(
        json.dumps(normalized_rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def list_voice_groups(rows: list[dict[str, str]] | None = None) -> list[str]:
    groups: list[str] = []
    for row in rows if rows is not None else load_voice_browser_metadata():
        group_name = _normalize_metadata_text(row.get("group"))
        if group_name and group_name not in groups:
            groups.append(group_name)
    return groups


def _resolve_uploaded_voice_audio_suffix(filename: str | None) -> str:
    suffix = Path(str(filename or "")).suffix.lower().strip()
    if suffix in ALLOWED_LOCAL_VOICE_AUDIO_SUFFIXES:
        return suffix
    raise ValueError(
        "Audio file must use one of: " + ", ".join(sorted(ALLOWED_LOCAL_VOICE_AUDIO_SUFFIXES))
    )


def _build_uploaded_voice_audio_filename(voice_name: str, suffix: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", voice_name.casefold()).strip("-")
    if not slug:
        slug = "voice"
    return f"{slug}-{uuid.uuid4().hex[:8]}{suffix}"


def _slugify_voice_id_base(display_name: str) -> str:
    normalized = unicodedata.normalize("NFKD", display_name)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.casefold()).strip("-")
    return slug or "voice"


def _build_unique_voice_id(display_name: str, existing_voice_ids: set[str]) -> str:
    base_slug = _slugify_voice_id_base(display_name)
    normalized_existing_ids = {voice_id.casefold() for voice_id in existing_voice_ids}
    suffix = 1
    while True:
        candidate = f"{base_slug}-{suffix:03d}"
        if candidate.casefold() not in normalized_existing_ids:
            return candidate
        suffix += 1


def _persist_uploaded_voice_audio(uploaded_file, *, voice_name: str) -> Path:
    if uploaded_file is None:
        raise ValueError("Audio file is required.")
    suffix = _resolve_uploaded_voice_audio_suffix(getattr(uploaded_file, "filename", None))
    LOCAL_VOICE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    target_path = (LOCAL_VOICE_ASSETS_DIR / _build_uploaded_voice_audio_filename(voice_name, suffix)).resolve()
    if target_path.parent != LOCAL_VOICE_ASSETS_DIR.resolve():
        raise ValueError("Invalid audio target path.")
    uploaded_file.save(str(target_path))
    if not target_path.is_file() or target_path.stat().st_size <= 0:
        _maybe_delete_generated_file(str(target_path))
        raise ValueError("Uploaded audio file is empty.")
    return target_path


def _replace_runtime_voice_presets(runtime: NanoTTSService, voice_presets: dict[str, VoicePreset]) -> None:
    runtime.voice_presets.clear()
    runtime.voice_presets.update(voice_presets)
    runtime.default_voice = DEFAULT_VOICE if DEFAULT_VOICE in runtime.voice_presets else next(iter(runtime.voice_presets))


def refresh_runtime_voice_presets() -> None:
    voice_presets = build_pocket_reader_voice_presets()
    runtime = get_runtime()
    _replace_runtime_voice_presets(runtime, voice_presets)
    if _runtime_manager is not None:
        _runtime_manager.refresh_voice_presets(voice_presets)


def build_pocket_reader_voice_presets() -> dict[str, VoicePreset]:
    presets = build_default_voice_presets()
    for row in load_voice_browser_metadata():
        voice_name = row["voice"]
        audio_file = row["audio_file"]
        if not audio_file:
            continue
        local_prompt_audio_path = (LOCAL_VOICE_ASSETS_DIR / audio_file).resolve()
        if not local_prompt_audio_path.is_file():
            continue
        existing_preset = presets.get(voice_name)
        presets[voice_name] = VoicePreset(
            name=voice_name,
            prompt_audio_path=local_prompt_audio_path,
            description=existing_preset.description if existing_preset is not None else f"Browser voice preset: {voice_name}",
        )

    existing_prompt_file_names = {preset.prompt_audio_path.name for preset in presets.values()}

    if not DEMO_METADATA_PATH.is_file():
        return presets

    try:
        rows = DEMO_METADATA_PATH.read_text(encoding="utf-8").splitlines()
    except Exception:
        logging.warning("Failed to read extra demo voice metadata: %s", DEMO_METADATA_PATH, exc_info=True)
        return presets

    added_voice_names: list[str] = []
    for line_index, line in enumerate(rows, start=1):
        if not line.strip():
            continue

        try:
            payload = json.loads(line)
        except Exception:
            logging.warning("Skipping invalid extra demo voice metadata line=%s", line_index, exc_info=True)
            continue

        prompt_audio_relative_path = str(payload.get("role") or "").strip()
        if not prompt_audio_relative_path:
            continue

        prompt_audio_path = (NANO_TTS_REPO_DIR / prompt_audio_relative_path).resolve()
        if not prompt_audio_path.is_file():
            logging.warning("Skipping missing extra demo prompt audio: %s", prompt_audio_path)
            continue
        if prompt_audio_path.name in existing_prompt_file_names:
            continue

        base_voice_name = _sanitize_demo_voice_name(payload.get("name"), prompt_audio_path.stem)
        voice_name = base_voice_name
        suffix = 2
        while voice_name in presets:
            voice_name = f"{base_voice_name} ({suffix})"
            suffix += 1

        presets[voice_name] = VoicePreset(
            name=voice_name,
            prompt_audio_path=prompt_audio_path,
            description=f"Additional demo voice from {NANO_TTS_REPO_DIR.name}",
        )
        existing_prompt_file_names.add(prompt_audio_path.name)
        added_voice_names.append(voice_name)

    if added_voice_names:
        logging.info(
            "Loaded %d additional demo voices from %s: %s",
            len(added_voice_names),
            NANO_TTS_REPO_DIR,
            added_voice_names,
        )

    return presets


def available_voices() -> list[str]:
    return get_runtime().list_voice_names()


def normalize_voice(voice_name: str | None) -> str:
    runtime = get_runtime()
    if voice_name and voice_name in runtime.list_voice_names():
        return voice_name
    return runtime.default_voice


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?。！？])\s*", text)
    return [part.strip() for part in parts if part and part.strip()]


def split_into_paragraphs(text: str) -> list[str]:
    paragraphs = re.split(r"\n\s*\n|\n(?=\s*[A-Z])", text)

    result: list[str] = []
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if paragraph and len(paragraph) > 10:
            result.append(paragraph)

    if len(result) <= 1 and len(text) > 500:
        result = []
        current_chunk: list[str] = []
        current_length = 0

        for sentence in split_sentences(text):
            current_chunk.append(sentence)
            current_length += len(sentence)
            if current_length >= 300:
                result.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0

        if current_chunk:
            result.append(" ".join(current_chunk))

    return result if result else [text]


def normalize_smart_quotes(text: str) -> str:
    return text.translate(SMART_QUOTE_MAP)


def _text_normalization_status_text(snapshot: TextNormalizationSnapshot | None) -> str:
    if snapshot is None:
        return "WeTextProcessing disabled."
    if snapshot.failed:
        return f"{snapshot.message} error={snapshot.error}"
    return snapshot.message


def prepare_request_texts(
    *,
    text: str,
    prompt_text: str | None,
    voice: str,
    data: dict,
) -> tuple[dict[str, object], TextNormalizationSnapshot | None]:
    text_normalizer_manager = get_text_normalizer_manager()
    manager_snapshot = text_normalizer_manager.snapshot()

    enable_text_normalization = _coerce_bool(
        data.get("enable_text_normalization"),
        _coerce_bool(DEFAULT_ENABLE_TEXT_NORMALIZATION, True),
    )
    enable_normalize_tts_text = _coerce_bool(
        data.get("enable_normalize_tts_text"),
        _coerce_bool(DEFAULT_ENABLE_ROBUST_TEXT_NORMALIZATION, enable_text_normalization)
        if enable_text_normalization
        else False,
    )

    enable_wetext = enable_text_normalization and not manager_snapshot.failed
    if enable_text_normalization and manager_snapshot.failed:
        logging.warning(
            "WeTextProcessing unavailable, falling back to robust normalization only: %s",
            manager_snapshot.error or manager_snapshot.message,
        )

    try:
        prepared = prepare_tts_request_texts(
            text=str(text or ""),
            prompt_text=str(prompt_text or ""),
            voice=voice,
            enable_wetext=enable_wetext,
            enable_normalize_tts_text=enable_normalize_tts_text,
            text_normalizer_manager=text_normalizer_manager,
        )
    except Exception:
        if enable_wetext:
            logging.warning("WeTextProcessing request normalization failed; retrying without wetext", exc_info=True)
            prepared = prepare_tts_request_texts(
                text=str(text or ""),
                prompt_text=str(prompt_text or ""),
                voice=voice,
                enable_wetext=False,
                enable_normalize_tts_text=enable_normalize_tts_text,
                text_normalizer_manager=text_normalizer_manager,
            )
        else:
            raise

    return prepared, text_normalizer_manager.snapshot()


def audio_to_wav_bytes(audio_array, sample_rate: int) -> bytes:
    audio_np = np.asarray(audio_array, dtype=np.float32)
    if audio_np.ndim == 1:
        audio_np = audio_np[:, None]
    elif audio_np.ndim == 2 and audio_np.shape[0] <= 8 and audio_np.shape[0] < audio_np.shape[1]:
        audio_np = audio_np.T
    elif audio_np.ndim != 2:
        raise ValueError(f"Unsupported audio array shape: {audio_np.shape}")

    audio_np = np.clip(audio_np, -1.0, 1.0)
    audio_int16 = (audio_np * 32767.0).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(int(audio_int16.shape[1]))
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_int16.tobytes())

    buffer.seek(0)
    return buffer.read()


def audio_to_pcm16le_bytes(audio_array) -> bytes:
    audio_np = np.asarray(audio_array, dtype=np.float32)
    if audio_np.ndim == 1:
        audio_np = audio_np[:, None]
    elif audio_np.ndim == 2 and audio_np.shape[0] <= 8 and audio_np.shape[0] < audio_np.shape[1]:
        audio_np = audio_np.T
    elif audio_np.ndim != 2:
        raise ValueError(f"Unsupported audio array shape: {audio_np.shape}")

    audio_np = np.clip(audio_np, -1.0, 1.0)
    audio_int16 = (audio_np * 32767.0).astype(np.int16)
    return audio_int16.tobytes()


def split_for_streaming(text: str, max_chars: int = 320) -> list[str]:
    paragraphs = split_into_paragraphs(text)
    chunks: list[str] = []

    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            chunks.append(paragraph)
            continue

        current: list[str] = []
        current_len = 0
        for sentence in split_sentences(paragraph):
            sentence_len = len(sentence)
            if current and current_len + sentence_len + 1 > max_chars:
                chunks.append(" ".join(current))
                current = [sentence]
                current_len = sentence_len
            else:
                current.append(sentence)
                current_len += sentence_len + (1 if current_len else 0)

        if current:
            chunks.append(" ".join(current))

    return chunks if chunks else [text]


def _coerce_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _coerce_int(value, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def _maybe_delete_generated_file(audio_path: str | None) -> None:
    if not audio_path:
        return
    try:
        Path(audio_path).unlink(missing_ok=True)
    except Exception:
        logging.warning("failed to remove generated file: %s", audio_path, exc_info=True)


def _normalize_attn_implementation(value: object) -> str:
    normalized = str(value or "model_default").strip().lower()
    if normalized in {"", "auto"}:
        return "model_default"
    if normalized in {"flash attention", "flash_attention_2"}:
        return "model_default"
    if normalized not in {"model_default", "sdpa", "eager"}:
        return "model_default"
    return normalized


def _normalize_execution_device(value: object) -> str:
    return "cpu"


def _resolve_attn_for_runtime(selected_runtime: NanoTTSService, requested_attn: object) -> str:
    normalized = str(requested_attn or "model_default").strip().lower()
    if selected_runtime.device.type != "cpu":
        return _normalize_attn_implementation(normalized)
    if normalized in {"", "auto", "default", "model_default", "flash_attention_2"}:
        return "eager"
    return _normalize_attn_implementation(normalized)


def _build_runtime_kwargs(data: dict, text: str, voice: str) -> dict[str, object]:
    raw_prompt_text = str(data.get("prompt_text") or "").strip()
    prompt_text = raw_prompt_text or None
    prompt_audio_path = data.get("prompt_audio_path")
    mode = str(data.get("mode", "voice_clone")).strip().lower() or "voice_clone"
    if mode not in {"continuation", "voice_clone"}:
        mode = "voice_clone"

    return {
        "text": text,
        "voice": voice,
        "mode": mode,
        "prompt_audio_path": prompt_audio_path,
        "prompt_text": prompt_text,
        "max_new_frames": int(data.get("max_new_frames", MAX_NEW_FRAMES)),
        "voice_clone_max_text_tokens": int(
            data.get("voice_clone_max_text_tokens", VOICE_CLONE_MAX_TEXT_TOKENS)
        ),
        "tts_max_batch_size": int(data.get("tts_max_batch_size", DEFAULT_TTS_MAX_BATCH_SIZE)),
        "codec_max_batch_size": int(data.get("codec_max_batch_size", 0)),
        "execution_device": _normalize_execution_device(data.get("execution_device", "default")),
        "cpu_threads": _coerce_int(data.get("cpu_threads", DEFAULT_CPU_THREADS), DEFAULT_CPU_THREADS),
        "attn_implementation": _normalize_attn_implementation(data.get("attn_implementation", "model_default")),
        "do_sample": _coerce_bool(data.get("do_sample"), True),
        "text_temperature": float(data.get("text_temperature", 1.0)),
        "text_top_p": float(data.get("text_top_p", 1.0)),
        "text_top_k": int(data.get("text_top_k", 50)),
        "audio_temperature": float(data.get("audio_temperature", 0.8)),
        "audio_top_p": float(data.get("audio_top_p", 0.95)),
        "audio_top_k": int(data.get("audio_top_k", 25)),
        "audio_repetition_penalty": float(data.get("audio_repetition_penalty", 1.2)),
        "seed": None if data.get("seed") in (None, "", 0, "0") else int(data["seed"]),
    }


def run_synthesis(data: dict, text: str, voice: str) -> dict[str, object]:
    runtime_manager = get_runtime_manager()
    runtime_kwargs = _build_runtime_kwargs(data, text, voice)
    requested_execution_device = str(runtime_kwargs.pop("execution_device", "default"))
    cpu_threads = _coerce_int(runtime_kwargs.pop("cpu_threads", 0), 0)

    def _run(selected_runtime: NanoTTSService) -> dict[str, object]:
        request_kwargs = dict(runtime_kwargs)
        request_kwargs["attn_implementation"] = _resolve_attn_for_runtime(
            selected_runtime,
            request_kwargs.get("attn_implementation"),
        )
        return selected_runtime.synthesize(**request_kwargs)

    result, execution_device, resolved_cpu_threads = runtime_manager.call_with_runtime(
        requested_execution_device=requested_execution_device,
        cpu_threads=cpu_threads,
        callback=_run,
    )
    result["execution_device"] = execution_device
    if resolved_cpu_threads is not None:
        result["cpu_threads"] = resolved_cpu_threads
    return result


def run_synthesis_stream(data: dict, text: str, voice: str):
    runtime_manager = get_runtime_manager()
    runtime_kwargs = _build_runtime_kwargs(data, text, voice)
    requested_execution_device = str(runtime_kwargs.pop("execution_device", "default"))
    cpu_threads = _coerce_int(runtime_kwargs.pop("cpu_threads", 0), 0)

    def _factory(selected_runtime: NanoTTSService):
        request_kwargs = dict(runtime_kwargs)
        request_kwargs["attn_implementation"] = _resolve_attn_for_runtime(
            selected_runtime,
            request_kwargs.get("attn_implementation"),
        )
        return selected_runtime.synthesize_stream(**request_kwargs)

    for event, execution_device, resolved_cpu_threads in runtime_manager.iter_with_runtime(
        requested_execution_device=requested_execution_device,
        cpu_threads=cpu_threads,
        factory=_factory,
    ):
        if isinstance(event, dict) and event.get("type") == "result":
            event = dict(event)
            event["execution_device"] = execution_device
            if resolved_cpu_threads is not None:
                event["cpu_threads"] = resolved_cpu_threads
        yield event


@app.route("/health", methods=["GET"])
def health():
    runtime = get_runtime()
    runtime_manager = get_runtime_manager()
    normalization_snapshot = get_text_normalizer_manager().snapshot()
    return jsonify(
        {
            "status": "ok",
            "engine": "nano-tts",
            "nano_tts_repo_path": str(NANO_TTS_REPO_DIR),
            "checkpoint_path": str(runtime.checkpoint_path),
            "audio_tokenizer_path": str(runtime.audio_tokenizer_path),
            "default_voice": runtime.default_voice,
            "device": str(runtime.device),
            "dtype": str(runtime.dtype),
            "attn_implementation": runtime.attn_implementation,
            "cpu_runtime_loaded": runtime_manager.is_cpu_runtime_loaded(),
            "default_cpu_threads": runtime_manager.default_cpu_threads,
            "text_normalization_status": _text_normalization_status_text(normalization_snapshot),
            "text_normalization_ready": normalization_snapshot.ready,
            "text_normalization_failed": normalization_snapshot.failed,
        }
    )


@app.route("/voices", methods=["GET"])
def list_voices():
    refresh_runtime_voice_presets()
    runtime = get_runtime()
    voice_names = runtime.list_voice_names()
    browser_metadata_rows = [
        row
        for row in load_voice_browser_metadata()
        if row["voice"] in voice_names
    ]
    return jsonify(
        {
            "voices": voice_names,
            "default": runtime.default_voice,
            "engine": "nano-tts",
            "voice_metadata": browser_metadata_rows,
            "voice_groups": list_voice_groups(browser_metadata_rows),
        }
    )


@app.route("/voices", methods=["POST"])
def create_voice():
    saved_audio_path: Path | None = None
    try:
        display_name = _normalize_uploaded_display_name(request.form.get("name"))
        group_name = _normalize_uploaded_voice_group(request.form.get("group"))
        uploaded_audio = request.files.get("audio")
        with VOICE_METADATA_LOCK:
            existing_rows = load_voice_browser_metadata()
            existing_voice_ids = set(build_pocket_reader_voice_presets().keys())
            existing_display_names = {
                str(row.get("display_name") or row["voice"]).casefold()
                for row in existing_rows
            }
            if display_name.casefold() in existing_display_names:
                return jsonify({"error": f"Display name '{display_name}' already exists."}), 409

            voice_id = _build_unique_voice_id(display_name, existing_voice_ids)

            saved_audio_path = _persist_uploaded_voice_audio(uploaded_audio, voice_name=voice_id)
            new_row = {
                "voice": voice_id,
                "display_name": display_name,
                "group": group_name,
                "audio_file": saved_audio_path.name,
            }
            try:
                updated_rows = [*existing_rows, new_row]
                save_voice_browser_metadata(updated_rows)
                refresh_runtime_voice_presets()
            except Exception:
                _maybe_delete_generated_file(str(saved_audio_path))
                raise

        runtime = get_runtime()
        return jsonify(
            {
                "voice": new_row,
                "voices": runtime.list_voice_names(),
                "voice_groups": list_voice_groups(updated_rows),
                "default": runtime.default_voice,
            }
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        logging.exception("Failed to save uploaded browser voice")
        return jsonify({"error": str(exc)}), 500


@app.route("/text-normalization-status", methods=["GET"])
def text_normalization_status():
    snapshot = get_text_normalizer_manager().snapshot()
    return jsonify(
        {
            "state": snapshot.state,
            "message": snapshot.message,
            "error": snapshot.error,
            "ready": snapshot.ready,
            "failed": snapshot.failed,
            "available": snapshot.available,
            "status_text": _text_normalization_status_text(snapshot),
        }
    )


@app.route("/paragraphs", methods=["POST"])
def get_paragraphs():
    data = request.get_json()

    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = str(data["text"])
    if not text.strip():
        return jsonify({"error": "Text cannot be empty"}), 400

    text = normalize_smart_quotes(text)
    paragraphs = split_into_paragraphs(text)

    return jsonify(
        {
            "paragraphs": paragraphs,
            "count": len(paragraphs),
        }
    )


@app.route("/synthesize", methods=["POST"])
def synthesize():
    data = request.get_json()

    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = str(data["text"])
    voice = normalize_voice(data.get("voice"))

    if not text.strip():
        return jsonify({"error": "Text cannot be empty"}), 400

    text = normalize_smart_quotes(text)
    prepared_texts, _ = prepare_request_texts(
        text=text,
        prompt_text=str(data.get("prompt_text") or "").strip() or None,
        voice=voice,
        data=data,
    )
    request_data = dict(data)
    request_data["prompt_text"] = prepared_texts["prompt_text"]

    try:
        normalized_text = str(prepared_texts["text"])
        logging.info(
            "Generating speech voice=%s chars=%d normalization=%s",
            voice,
            len(normalized_text),
            prepared_texts["normalization_method"],
        )
        result = run_synthesis(request_data, normalized_text, voice)
        wav_bytes = audio_to_wav_bytes(result["waveform_numpy"], int(result["sample_rate"]))
        _maybe_delete_generated_file(result["audio_path"])

        return Response(
            wav_bytes,
            mimetype="audio/wav",
            headers={"Content-Disposition": "attachment; filename=speech.wav"},
        )
    except Exception as exc:
        logging.exception("Error generating speech")
        return jsonify({"error": str(exc)}), 500


@app.route("/synthesize-stream", methods=["POST"])
def synthesize_stream():
    data = request.get_json()

    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = str(data["text"])
    voice = normalize_voice(data.get("voice"))

    if not text.strip():
        return jsonify({"error": "Text cannot be empty"}), 400

    text = normalize_smart_quotes(text)
    prepared_texts, _ = prepare_request_texts(
        text=text,
        prompt_text=str(data.get("prompt_text") or "").strip() or None,
        voice=voice,
        data=data,
    )
    request_data = dict(data)
    request_data["prompt_text"] = prepared_texts["prompt_text"]
    normalized_text = str(prepared_texts["text"])

    def generate_stream():
        try:
            chunks = split_for_streaming(normalized_text)
            for index, chunk in enumerate(chunks):
                result = run_synthesis(request_data, chunk, voice)
                wav_bytes = audio_to_wav_bytes(result["waveform_numpy"], int(result["sample_rate"]))
                _maybe_delete_generated_file(result["audio_path"])
                payload = {
                    "type": "chunk",
                    "index": index,
                    "audio": base64.b64encode(wav_bytes).decode("ascii"),
                }
                yield json.dumps(payload) + "\n"

            yield json.dumps({"type": "done", "count": len(chunks)}) + "\n"
        except Exception as exc:
            logging.exception("Error streaming speech")
            yield json.dumps({"type": "error", "error": str(exc)}) + "\n"

    return Response(generate_stream(), mimetype="application/x-ndjson")


@app.route("/synthesize-realtime", methods=["POST"])
def synthesize_realtime():
    data = request.get_json()

    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = str(data["text"])
    voice = normalize_voice(data.get("voice"))

    if not text.strip():
        return jsonify({"error": "Text cannot be empty"}), 400

    text = normalize_smart_quotes(text)
    prepared_texts, _ = prepare_request_texts(
        text=text,
        prompt_text=str(data.get("prompt_text") or "").strip() or None,
        voice=voice,
        data=data,
    )
    request_data = dict(data)
    request_data["prompt_text"] = prepared_texts["prompt_text"]
    normalized_text = str(prepared_texts["text"])

    def generate_pcm_stream():
        generated_audio_path: str | None = None
        try:
            for event in run_synthesis_stream(request_data, normalized_text, voice):
                event_type = str(event.get("type", ""))
                if event_type == "audio":
                    pcm_bytes = audio_to_pcm16le_bytes(event["waveform_numpy"])
                    if pcm_bytes:
                        yield pcm_bytes
                    continue
                if event_type == "result":
                    generated_audio_path = str(event.get("audio_path") or "")
        except Exception:
            logging.exception("Error generating realtime speech stream")
            raise
        finally:
            _maybe_delete_generated_file(generated_audio_path)

    return Response(
        generate_pcm_stream(),
        mimetype="application/octet-stream",
        headers={
            "X-Audio-Codec": "pcm_s16le",
            "X-Audio-Sample-Rate": str(STREAM_AUDIO_SAMPLE_RATE),
            "X-Audio-Channels": str(STREAM_AUDIO_CHANNELS),
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0, no-transform",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.route("/preload", methods=["POST"])
def preload():
    data = request.get_json() or {}
    voices_to_load = [normalize_voice(voice) for voice in data.get("voices", [DEFAULT_VOICE])]
    run_warmup = _coerce_bool(data.get("warmup"), False)
    preload_text_normalization = _coerce_bool(data.get("text_normalization"), True)

    try:
        runtime = get_runtime()
        preload_result = runtime.preload(voices=voices_to_load, load_model=True)
        normalization_snapshot = None
        if preload_text_normalization:
            normalization_snapshot = get_text_normalizer_manager().ensure_ready()
        if run_warmup:
            warmup_result = runtime.warmup(voice=voices_to_load[0] if voices_to_load else runtime.default_voice)
            _maybe_delete_generated_file(warmup_result["audio_path"])
        return jsonify(
            {
                "status": "ok",
                "loaded_voices": preload_result["loaded_voices"],
                "device": preload_result["device"],
                "dtype": preload_result["dtype"],
                "attn_implementation": preload_result["attn_implementation"],
                "warmup": bool(run_warmup),
                "text_normalization_status": _text_normalization_status_text(normalization_snapshot),
            }
        )
    except Exception as exc:
        logging.exception("Error preloading Nano-TTS runtime")
        return jsonify({"error": str(exc)}), 500


def main(argv: list[str] | None = None):
    global CHECKPOINT_PATH, AUDIO_TOKENIZER_PATH, OUTPUT_DIR, DEVICE, DTYPE, ATTN_IMPLEMENTATION

    parser = argparse.ArgumentParser(description="Nano Reader local TTS server")
    parser.add_argument(
        "--nano-tts-repo-path",
        "--nano_tts_repo_path",
        dest="nano_tts_repo_path",
        type=str,
        default=str(NANO_TTS_REPO_DIR),
    )
    parser.add_argument("--checkpoint-path", "--checkpoint_path", dest="checkpoint_path", type=str, default=CHECKPOINT_PATH)
    parser.add_argument(
        "--audio-tokenizer-path",
        "--audio_tokenizer_path",
        dest="audio_tokenizer_path",
        type=str,
        default=AUDIO_TOKENIZER_PATH,
    )
    parser.add_argument("--output-dir", "--output_dir", dest="output_dir", type=str, default=str(OUTPUT_DIR))
    parser.add_argument("--device", type=str, default=REQUESTED_DEVICE, choices=["cpu", "auto"])
    parser.add_argument("--dtype", type=str, default=DTYPE, choices=["auto", "float32", "float16", "bfloat16"])
    parser.add_argument(
        "--attn-implementation",
        "--attn_implementation",
        dest="attn_implementation",
        type=str,
        default=ATTN_IMPLEMENTATION,
        choices=["auto", "model_default", "sdpa", "eager"],
    )
    parser.add_argument("--host", type=str, default=os.getenv("NANO_TTS_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("NANO_TTS_PORT", "5050")))
    args = parser.parse_args(argv)

    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        level=logging.INFO,
    )

    configured_repo_dir = Path(args.nano_tts_repo_path).expanduser().resolve()
    if configured_repo_dir != NANO_TTS_REPO_DIR:
        logging.warning(
            "The runtime repo path is resolved before import. To change it for this server, set NANO_TTS_REPO_PATH before launch. active=%s requested=%s",
            NANO_TTS_REPO_DIR,
            configured_repo_dir,
        )

    if args.checkpoint_path == str(DEFAULT_LOCAL_CHECKPOINT_PATH):
        _ensure_default_model_dir(
            DEFAULT_LOCAL_CHECKPOINT_PATH,
            label="checkpoint directory",
            repo_id=DEFAULT_CHECKPOINT_REPO_ID,
            required_files=("config.json",),
            required_any_files=("pytorch_model.bin", "model.safetensors.index.json", "model-00001-of-00001.safetensors"),
            flag_names=("--checkpoint-path", "--checkpoint_path"),
            env_key="NANO_TTS_CHECKPOINT_PATH",
        )
    if args.audio_tokenizer_path == str(DEFAULT_LOCAL_AUDIO_TOKENIZER_PATH):
        _ensure_default_model_dir(
            DEFAULT_LOCAL_AUDIO_TOKENIZER_PATH,
            label="audio tokenizer directory",
            repo_id=DEFAULT_AUDIO_TOKENIZER_REPO_ID,
            required_files=("config.json",),
            required_any_files=("model.safetensors.index.json", "model-00001-of-00001.safetensors", "pytorch_model.bin"),
            flag_names=("--audio-tokenizer-path", "--audio_tokenizer_path"),
            env_key="NANO_TTS_AUDIO_TOKENIZER_PATH",
        )

    CHECKPOINT_PATH = args.checkpoint_path
    AUDIO_TOKENIZER_PATH = args.audio_tokenizer_path
    OUTPUT_DIR = Path(args.output_dir).expanduser()
    DTYPE = args.dtype
    ATTN_IMPLEMENTATION = _normalize_attn_implementation(args.attn_implementation)
    DEVICE = "cpu"
    if args.device != "cpu":
        logging.info("CPU-only app mode: ignoring --device=%s and forcing cpu.", args.device)

    runtime = get_runtime()
    logging.info("Starting Nano Reader Nano-TTS Server")
    if NANO_TTS_REPO_DIR != DEFAULT_NANO_TTS_REPO_DIR:
        logging.info("Using custom Nano-TTS repo path: %s", NANO_TTS_REPO_DIR)
    if CHECKPOINT_PATH != str(DEFAULT_LOCAL_CHECKPOINT_PATH):
        logging.info("Using custom checkpoint path: %s", CHECKPOINT_PATH)
    if AUDIO_TOKENIZER_PATH != str(DEFAULT_LOCAL_AUDIO_TOKENIZER_PATH):
        logging.info("Using custom audio tokenizer path: %s", AUDIO_TOKENIZER_PATH)
    logging.info("Nano-TTS repo path: %s", NANO_TTS_REPO_DIR)
    logging.info("Available voices: %s", runtime.list_voice_names())
    logging.info("Checkpoint path: %s", runtime.checkpoint_path)
    logging.info("Audio tokenizer path: %s", runtime.audio_tokenizer_path)
    logging.info("Server running at http://%s:%s", args.host, args.port)

    normalization_snapshot = get_text_normalizer_manager().ensure_ready()
    if normalization_snapshot.failed:
        logging.warning(
            "WeTextProcessing preload did not finish successfully at startup. status=%s error=%s",
            normalization_snapshot.message,
            normalization_snapshot.error,
        )
    logging.info("Nano Reader is loading. Please wait.")
    runtime.preload(voices=[runtime.default_voice], load_model=True)
    logging.info("Nano Reader has finished loading. Welcome.")
    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()

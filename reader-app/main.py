from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from PySide6.QtCore import QObject, QProcess, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QCloseEvent
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PySide6.QtWidgets import (
    QApplication,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QPlainTextEdit,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

APP_TITLE = "Nano Reader App"
DEFAULT_SERVER_HOST = "127.0.0.1"
DEFAULT_SERVER_PORT = 5050
HEALTH_POLL_INTERVAL_MS = 1500
STOP_TIMEOUT_MS = 4000
MAX_LOG_LINES = 4000


class ServerController(QObject):
    status_changed = Signal(str, str)
    log_received = Signal(str)
    health_changed = Signal(dict)
    running_changed = Signal(bool)

    def __init__(self, repo_root: Path) -> None:
        super().__init__()
        self.repo_root = repo_root
        self.reader_app_root = repo_root / "reader-app"
        self.server_script = repo_root / "server" / "server.py"
        self.server_host = DEFAULT_SERVER_HOST
        self.server_port = DEFAULT_SERVER_PORT
        self.server_url = f"http://localhost:{self.server_port}"
        self.health_url = f"{self.server_url}/health"
        self.logs_dir = self.reader_app_root / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        self.process = QProcess(self)
        self.process.setProcessChannelMode(QProcess.SeparateChannels)
        self.process.started.connect(self._on_process_started)
        self.process.readyReadStandardOutput.connect(self._on_stdout_ready)
        self.process.readyReadStandardError.connect(self._on_stderr_ready)
        self.process.finished.connect(self._on_process_finished)
        self.process.errorOccurred.connect(self._on_process_error)

        self.network = QNetworkAccessManager(self)
        self.health_timer = QTimer(self)
        self.health_timer.setInterval(HEALTH_POLL_INTERVAL_MS)
        self.health_timer.timeout.connect(self.poll_health)

        self.force_stop_timer = QTimer(self)
        self.force_stop_timer.setSingleShot(True)
        self.force_stop_timer.timeout.connect(self._force_kill_if_needed)

        self._stdout_buffer = ""
        self._stderr_buffer = ""
        self._log_handle = None
        self._health_request_in_flight = False
        self._pending_action: str | None = None
        self._closing = False
        self._last_status = "stopped"
        self._set_status("stopped", "Server stopped.")

    def start_server(self) -> None:
        if self.is_running():
            return
        if not self.server_script.is_file():
            self._set_status("error", f"Missing server script: {self.server_script}")
            return

        self._stdout_buffer = ""
        self._stderr_buffer = ""
        self._open_log_file()

        program = self._resolve_python_program()
        arguments = self._build_process_arguments(program)

        self.process.setWorkingDirectory(str(self.repo_root))
        self.process.setProgram(program)
        self.process.setArguments(arguments)
        self._set_status("starting", "Starting server process...")
        self.process.start()

    def stop_server(self) -> None:
        if not self.is_running():
            self._set_status("stopped", "Server stopped.")
            return
        self._set_status("stopping", "Stopping server process...")
        self.process.terminate()
        self.force_stop_timer.start(STOP_TIMEOUT_MS)

    def restart_server(self) -> None:
        if self.is_running():
            self._pending_action = "restart"
            self._set_status("restarting", "Restarting server process...")
            self.stop_server()
        else:
            self._pending_action = None
            self.start_server()

    def reload_model(self) -> None:
        if self.is_running():
            self._pending_action = "reload_model"
            self._set_status("reloading_model", "Reloading model by restarting the server...")
            self.stop_server()
        else:
            self._pending_action = None
            self.start_server()

    def shutdown_and_wait(self) -> None:
        self._closing = True
        self._pending_action = None
        if not self.is_running():
            return
        self.process.terminate()
        if not self.process.waitForFinished(STOP_TIMEOUT_MS):
            self.process.kill()
            self.process.waitForFinished(2000)

    def is_running(self) -> bool:
        return self.process.state() != QProcess.NotRunning

    def poll_health(self) -> None:
        if not self.is_running() or self._health_request_in_flight:
            return
        self._health_request_in_flight = True
        reply = self.network.get(QNetworkRequest(QUrl(self.health_url)))
        reply.finished.connect(lambda reply=reply: self._handle_health_reply(reply))

    def _resolve_python_program(self) -> str:
        configured = os.getenv("READER_APP_PYTHON", "").strip()
        if configured:
            return configured
        return sys.executable

    def _build_process_arguments(self, program: str) -> list[str]:
        arguments: list[str] = []
        normalized_program_name = Path(program).name.lower()
        if normalized_program_name.startswith("python"):
            arguments.append("-u")
        arguments.extend(
            [
                str(self.server_script),
                "--host",
                self.server_host,
                "--port",
                str(self.server_port),
            ]
        )
        return arguments

    def _open_log_file(self) -> None:
        self._close_log_file()
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        log_path = self.logs_dir / f"reader_app_{timestamp}.log"
        self._log_handle = log_path.open("a", encoding="utf-8", buffering=1)
        self.log_received.emit(f"[reader-app] Writing logs to {log_path}")

    def _close_log_file(self) -> None:
        if self._log_handle is not None:
            self._log_handle.close()
            self._log_handle = None

    def _emit_log_line(self, line: str) -> None:
        cleaned = line.rstrip("\r\n")
        if not cleaned:
            return
        if self._log_handle is not None:
            self._log_handle.write(cleaned + "\n")
        self.log_received.emit(cleaned)
        self._update_status_from_log(cleaned)

    def _consume_process_buffer(self, raw_text: str, *, source: str) -> None:
        buffer_name = "_stdout_buffer" if source == "stdout" else "_stderr_buffer"
        combined = getattr(self, buffer_name) + raw_text
        lines = combined.splitlines(keepends=True)
        remainder = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            remainder = lines.pop()
        setattr(self, buffer_name, remainder)
        for line in lines:
            self._emit_log_line(line)

    def _on_process_started(self) -> None:
        self.running_changed.emit(True)
        self.health_timer.start()
        QTimer.singleShot(200, self.poll_health)
        self._emit_log_line(f"[reader-app] Server process started at {self.server_url}")

    def _on_stdout_ready(self) -> None:
        chunk = bytes(self.process.readAllStandardOutput()).decode("utf-8", errors="replace")
        self._consume_process_buffer(chunk, source="stdout")

    def _on_stderr_ready(self) -> None:
        chunk = bytes(self.process.readAllStandardError()).decode("utf-8", errors="replace")
        self._consume_process_buffer(chunk, source="stderr")

    def _on_process_error(self, error: QProcess.ProcessError) -> None:
        if not self.is_running():
            self._close_log_file()
            self.running_changed.emit(False)
        self._set_status("error", f"Process error: {error}")

    def _on_process_finished(self, exit_code: int, exit_status: QProcess.ExitStatus) -> None:
        self.force_stop_timer.stop()
        self.health_timer.stop()
        self._health_request_in_flight = False
        self.running_changed.emit(False)
        self._flush_partial_buffers()

        was_closing = self._closing
        pending_action = self._pending_action
        self._pending_action = None

        if pending_action == "restart":
            self._emit_log_line("[reader-app] Restarting server after shutdown.")
            self.start_server()
            return
        if pending_action == "reload_model":
            self._emit_log_line("[reader-app] Restarting server to reload model.")
            self.start_server()
            return

        if was_closing:
            self._set_status("stopped", "Server stopped.")
        elif exit_code == 0 and exit_status == QProcess.NormalExit:
            self._set_status("stopped", "Server stopped.")
        else:
            self._set_status("error", f"Server exited unexpectedly (code={exit_code}).")

        self._close_log_file()

    def _flush_partial_buffers(self) -> None:
        if self._stdout_buffer:
            self._emit_log_line(self._stdout_buffer)
            self._stdout_buffer = ""
        if self._stderr_buffer:
            self._emit_log_line(self._stderr_buffer)
            self._stderr_buffer = ""

    def _handle_health_reply(self, reply: QNetworkReply) -> None:
        self._health_request_in_flight = False
        if reply.error() != QNetworkReply.NoError:
            reply.deleteLater()
            return
        payload = bytes(reply.readAll()).decode("utf-8", errors="replace")
        reply.deleteLater()
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return
        self.health_changed.emit(data)
        self._set_status("ready", "Server is ready.")

    def _force_kill_if_needed(self) -> None:
        if self.is_running():
            self._emit_log_line("[reader-app] Termination timed out. Killing server process.")
            self.process.kill()

    def _update_status_from_log(self, line: str) -> None:
        lower_line = line.lower()
        if "downloading" in lower_line and "hugging face" in lower_line:
            self._set_status("downloading", "Downloading model files...")
        elif "nano reader is loading. please wait." in lower_line:
            self._set_status("loading", "Loading model. Please wait...")
        elif "nano reader has finished loading. welcome." in lower_line:
            self._set_status("loading", "Model load finished. Waiting for health check...")
        elif "failed" in lower_line and "traceback" not in lower_line and self._last_status not in {"error", "stopped"}:
            self._set_status("error", line)

    def _set_status(self, state: str, message: str) -> None:
        self._last_status = state
        self.status_changed.emit(state, message)


class ReaderAppWindow(QMainWindow):
    def __init__(self, controller: ServerController) -> None:
        super().__init__()
        self.controller = controller
        self.setWindowTitle(APP_TITLE)
        self.resize(960, 720)

        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        root_layout = QVBoxLayout(central_widget)
        root_layout.setContentsMargins(14, 14, 14, 14)
        root_layout.setSpacing(12)

        header_layout = QHBoxLayout()
        header_layout.setSpacing(12)

        self.status_label = QLabel("Stopped")
        self.status_label.setObjectName("statusLabel")
        self.status_label.setAlignment(Qt.AlignCenter)
        self.status_label.setMinimumWidth(180)
        self.status_label.setStyleSheet(self._status_stylesheet("stopped"))

        self.status_detail_label = QLabel("Server stopped.")
        self.status_detail_label.setWordWrap(True)

        header_text_layout = QVBoxLayout()
        header_text_layout.addWidget(self.status_label, alignment=Qt.AlignLeft)
        header_text_layout.addWidget(self.status_detail_label)

        header_layout.addLayout(header_text_layout)
        header_layout.addStretch(1)

        button_layout = QHBoxLayout()
        button_layout.setSpacing(8)

        self.start_button = QPushButton("Start")
        self.stop_button = QPushButton("Stop")
        self.reload_server_button = QPushButton("Reload Server")
        self.reload_model_button = QPushButton("Reload Model")
        self.clear_logs_button = QPushButton("Clear Logs")
        self.reload_model_button.setToolTip("Current first version reloads the model by restarting the server process.")

        button_layout.addWidget(self.start_button)
        button_layout.addWidget(self.stop_button)
        button_layout.addWidget(self.reload_server_button)
        button_layout.addWidget(self.reload_model_button)
        button_layout.addWidget(self.clear_logs_button)

        root_layout.addLayout(header_layout)
        root_layout.addLayout(button_layout)

        info_layout = QGridLayout()
        info_layout.setHorizontalSpacing(12)
        info_layout.setVerticalSpacing(8)

        self.server_url_value = self._make_value_label(controller.server_url)
        self.health_value = self._make_value_label("Not reachable yet")
        self.checkpoint_value = self._make_value_label(str((controller.repo_root / "models" / "MOSS-TTS-Nano").resolve()))
        self.audio_tokenizer_value = self._make_value_label(
            str((controller.repo_root / "models" / "MOSS-Audio-Tokenizer-Nano").resolve())
        )
        self.default_voice_value = self._make_value_label("Unknown")
        self.text_normalization_value = self._make_value_label("Unknown")

        info_layout.addWidget(QLabel("Server URL"), 0, 0)
        info_layout.addWidget(self.server_url_value, 0, 1)
        info_layout.addWidget(QLabel("Health"), 1, 0)
        info_layout.addWidget(self.health_value, 1, 1)
        info_layout.addWidget(QLabel("Checkpoint Path"), 2, 0)
        info_layout.addWidget(self.checkpoint_value, 2, 1)
        info_layout.addWidget(QLabel("Audio Tokenizer Path"), 3, 0)
        info_layout.addWidget(self.audio_tokenizer_value, 3, 1)
        info_layout.addWidget(QLabel("Default Voice"), 4, 0)
        info_layout.addWidget(self.default_voice_value, 4, 1)
        info_layout.addWidget(QLabel("Text Normalization"), 5, 0)
        info_layout.addWidget(self.text_normalization_value, 5, 1)

        root_layout.addLayout(info_layout)

        self.log_view = QPlainTextEdit()
        self.log_view.setReadOnly(True)
        self.log_view.setMaximumBlockCount(MAX_LOG_LINES)
        self.log_view.setLineWrapMode(QPlainTextEdit.NoWrap)
        self.log_view.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        root_layout.addWidget(self.log_view, stretch=1)

        self.start_button.clicked.connect(self.controller.start_server)
        self.stop_button.clicked.connect(self.controller.stop_server)
        self.reload_server_button.clicked.connect(self.controller.restart_server)
        self.reload_model_button.clicked.connect(self.controller.reload_model)
        self.clear_logs_button.clicked.connect(self.log_view.clear)

        self.controller.status_changed.connect(self._on_status_changed)
        self.controller.log_received.connect(self._append_log_line)
        self.controller.health_changed.connect(self._on_health_changed)
        self.controller.running_changed.connect(self._on_running_changed)

        self._on_running_changed(False)

    def closeEvent(self, event: QCloseEvent) -> None:
        self.controller.shutdown_and_wait()
        event.accept()

    def _append_log_line(self, line: str) -> None:
        self.log_view.appendPlainText(line)

    def _on_status_changed(self, state: str, message: str) -> None:
        self.status_label.setText(state.replace("_", " ").title())
        self.status_label.setStyleSheet(self._status_stylesheet(state))
        self.status_detail_label.setText(message)

    def _on_health_changed(self, payload: dict) -> None:
        self.health_value.setText(payload.get("status", "ok"))
        self.checkpoint_value.setText(str(payload.get("checkpoint_path") or self.checkpoint_value.text()))
        self.audio_tokenizer_value.setText(
            str(payload.get("audio_tokenizer_path") or self.audio_tokenizer_value.text())
        )
        self.default_voice_value.setText(str(payload.get("default") or payload.get("default_voice") or "Unknown"))
        self.text_normalization_value.setText(str(payload.get("text_normalization_status") or "Unknown"))

    def _on_running_changed(self, running: bool) -> None:
        self.start_button.setEnabled(not running)
        self.stop_button.setEnabled(running)
        self.reload_server_button.setEnabled(running)
        self.reload_model_button.setEnabled(running)

    def _make_value_label(self, text: str) -> QLabel:
        label = QLabel(text)
        label.setWordWrap(True)
        label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        return label

    def _status_stylesheet(self, state: str) -> str:
        colors = {
            "stopped": ("#475569", "#e2e8f0"),
            "starting": ("#1d4ed8", "#dbeafe"),
            "downloading": ("#b45309", "#fef3c7"),
            "loading": ("#0f766e", "#ccfbf1"),
            "ready": ("#166534", "#dcfce7"),
            "stopping": ("#9a3412", "#ffedd5"),
            "restarting": ("#5b21b6", "#ede9fe"),
            "reloading_model": ("#5b21b6", "#ede9fe"),
            "error": ("#991b1b", "#fee2e2"),
        }
        foreground, background = colors.get(state, ("#1e293b", "#e2e8f0"))
        return (
            "QLabel#statusLabel {"
            f"color: {foreground};"
            f"background: {background};"
            "border-radius: 8px;"
            "padding: 8px 14px;"
            "font-weight: 700;"
            "}"
        )


def main() -> int:
    app = QApplication(sys.argv)
    repo_root = Path(__file__).resolve().parent.parent
    controller = ServerController(repo_root=repo_root)
    window = ReaderAppWindow(controller=controller)
    window.show()
    QTimer.singleShot(0, controller.start_server)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())

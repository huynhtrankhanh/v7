import argparse
import json
import os
import posixpath
import time
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

from v7_python_model import TrainedV7Model, TransformerReranker


class InferenceHandler(SimpleHTTPRequestHandler):
    model: TrainedV7Model
    beam_width: int
    reranker: Optional[TransformerReranker]

    def do_POST(self) -> None:
        if self.path != "/infer":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
            islands = payload.get("islands", [])
            if not isinstance(islands, list) or not all(isinstance(x, str) for x in islands):
                raise ValueError("Invalid islands payload")
        except Exception:
            self._send_json({"candidates": []}, status=HTTPStatus.BAD_REQUEST)
            return

        start = time.time()
        try:
            candidates = self.model.infer_islands(
                islands,
                beam_width=self.beam_width,
                reranker=self.reranker,
            )
        except Exception:
            candidates = []
        elapsed_ms = int((time.time() - start) * 1000)
        self.log_message("POST /infer islands=%d candidates=%d duration_ms=%d", len(islands), len(candidates), elapsed_ms)
        self._send_json({"candidates": candidates})

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path: str) -> str:
        # Keep static serving behavior compatible with existing web demo.
        path = path.split("?", 1)[0]
        path = path.split("#", 1)[0]
        trailing_slash = path.rstrip().endswith("/")
        path = urllib.parse.unquote(path, errors="surrogatepass")
        path = posixpath.normpath(path)
        words = [word for word in path.split("/") if word]
        resolved = self.directory
        for word in words:
            _, word = os.path.splitdrive(word)
            _, word = os.path.split(word)
            if word in (os.curdir, os.pardir):
                continue
            resolved = os.path.join(resolved, word)
        if trailing_slash:
            resolved += "/"
        return resolved


def run_server(
    model_path: str,
    static_dir: str,
    port: int,
    beam_width: int,
    transformer_model_path: Optional[str],
    transformer_max_length: int,
) -> None:
    model = TrainedV7Model.from_json(model_path)
    reranker = TransformerReranker(transformer_model_path, max_length=transformer_max_length) if transformer_model_path else None
    handler_cls = InferenceHandler
    handler_cls.model = model
    handler_cls.beam_width = beam_width
    handler_cls.reranker = reranker
    handler_cls.directory = static_dir
    server = ThreadingHTTPServer(("0.0.0.0", port), handler_cls)
    print(
        f"Listening on 0.0.0.0:{port} (model={model_path}, static={static_dir}, "
        f"transformer={transformer_model_path or 'disabled'})"
    )
    server.serve_forever()


def _main() -> None:
    parser = argparse.ArgumentParser(description="Python V7 inference server with /infer API compatibility.")
    parser.add_argument("--model-path", default="v7_python_model.json")
    parser.add_argument("--static-dir", default="static")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--beam-width", type=int, default=40)
    parser.add_argument("--transformer-model-path", default=None, help="HF model path/name for reranking")
    parser.add_argument("--transformer-max-length", type=int, default=128)
    args = parser.parse_args()
    run_server(
        model_path=args.model_path,
        static_dir=args.static_dir,
        port=args.port,
        beam_width=args.beam_width,
        transformer_model_path=args.transformer_model_path,
        transformer_max_length=args.transformer_max_length,
    )


if __name__ == "__main__":
    _main()

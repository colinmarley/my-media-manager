"""Transcribe the audio clips bench.py extracted for files without text subtitles.

Needs faster-whisper, so it runs in a throwaway container:

  docker run --rm -v /data/mmm-content-bench:/b -v /data/mmm-content-bench/hf:/root/.cache/huggingface \
    python:3.11-slim sh -c "pip install -q faster-whisper && python /b/transcribe.py --work /b/work"
"""

import argparse
import glob
import json
import os
import time


def load(args):
    """Returns transcribe(path) -> (text lines, audio seconds)."""
    if args.backend == "openai":
        import torch
        import whisper

        torch.set_num_threads(args.threads)
        model = whisper.load_model(args.model, device=args.device)

        def run(path):
            # The clips are already 16 kHz mono PCM; read them directly so the container needs no ffmpeg.
            import wave

            import numpy as np

            with wave.open(path, "rb") as wav:
                audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
            result = model.transcribe(audio, language="en", fp16=args.device != "cpu", beam_size=1,
                                      condition_on_previous_text=False)
            segments = result.get("segments") or []
            return [s["text"].strip() for s in segments], (segments[-1]["end"] if segments else 0.0)

        return run

    from faster_whisper import WhisperModel

    compute = "int8" if args.device == "cpu" else "float16"
    model = WhisperModel(args.model, device=args.device, compute_type=compute, cpu_threads=args.threads)

    def run(path):
        segments, info = model.transcribe(path, language="en", vad_filter=True, beam_size=1)
        return [seg.text.strip() for seg in segments], info.duration

    return run


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--backend", choices=["faster", "openai"], default="faster")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--threads", type=int, default=16)
    args = ap.parse_args()

    transcribe = load(args)
    dirs = sorted(d for d in glob.glob(os.path.join(args.work, "*")) if glob.glob(os.path.join(d, "a*.wav")))
    for n, d in enumerate(dirs, start=1):
        out = os.path.join(d, "whisper.txt")
        if os.path.exists(out):
            continue
        started, lines, audio_s = time.time(), [], 0.0
        for clip in sorted(glob.glob(os.path.join(d, "a*.wav"))):
            text, seconds = transcribe(clip)
            lines.extend(text)
            audio_s += seconds
        with open(out + ".tmp", "w", encoding="utf-8") as fh:
            fh.write("\n".join(line for line in lines if line))
        os.replace(out + ".tmp", out)
        took = time.time() - started
        with open(os.path.join(d, "whisper.json"), "w", encoding="utf-8") as fh:
            json.dump({"model": args.model, "device": args.device, "audio_s": round(audio_s), "took_s": round(took, 1)}, fh)
        print(f"[{n}/{len(dirs)}] {audio_s:.0f}s of audio in {took:.0f}s, {sum(len(x) for x in lines)} chars", flush=True)


if __name__ == "__main__":
    main()

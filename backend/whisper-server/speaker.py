"""
Speaker identification helpers using pyannote.audio.

Strategy: keep it simple — compute one speaker embedding per audio clip
and compare to an enrolled embedding via cosine similarity.

The model `pyannote/embedding` is gated on Hugging Face:
  1. Get a token at https://huggingface.co/settings/tokens
  2. Accept the model terms at https://hf.co/pyannote/embedding
  3. Export it as HF_TOKEN in the whisper-server environment.
"""

import os
import subprocess
import tempfile

import numpy as np


HF_TOKEN = os.environ.get('HF_TOKEN') or os.environ.get('HUGGINGFACE_TOKEN') or ''
# Dual-threshold hysteresis so we only commit a label when reasonably confident.
# pyannote/embedding cosine similarities are typically:
#   >= 0.45  same speaker
#   <= 0.25  different speaker
#   between  ambiguous -> UNKNOWN (better than guessing wrong)
SIM_HIGH = float(os.environ.get('SPEAKER_SIM_HIGH', '0.30'))
SIM_LOW = float(os.environ.get('SPEAKER_SIM_LOW', '0.18'))
# Segment extraction tuning for live chunks.
SEGMENT_MIN_DURATION = float(os.environ.get('SPEAKER_SEGMENT_MIN_DURATION', '0.45'))
SEGMENT_PAD_SEC = float(os.environ.get('SPEAKER_SEGMENT_PAD_SEC', '0.20'))
# Legacy single-threshold fallback for whole-chunk labeling.
SIM_THRESHOLD = float(os.environ.get('SPEAKER_SIM_THRESHOLD', str(SIM_HIGH)))

_inference = None


def speaker_available() -> bool:
    return bool(HF_TOKEN)


def _get_inference():
    global _inference
    if _inference is not None:
        return _inference

    if not HF_TOKEN:
        raise RuntimeError(
            'HF_TOKEN not set. Generate a token at https://huggingface.co/settings/tokens '
            'and accept the model terms at https://hf.co/pyannote/embedding.'
        )

    from pyannote.audio import Model, Inference

    print('Loading pyannote/embedding model...')
    model = Model.from_pretrained('pyannote/embedding', use_auth_token=HF_TOKEN)
    _inference = Inference(model, window='whole')
    print('pyannote embedding model loaded.')
    return _inference


def ensure_wav(input_path: str, sr: int = 16000) -> str:
    """Convert any audio file (webm, m4a, etc.) to 16k mono wav via ffmpeg."""
    out = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    subprocess.run(
        ['ffmpeg', '-y', '-i', input_path, '-ar', str(sr), '-ac', '1', out],
        check=True,
        capture_output=True,
    )
    return out


def compute_embedding(audio_path: str) -> list:
    """Return a 1D embedding vector as a Python list of floats."""
    inf = _get_inference()
    wav_path = ensure_wav(audio_path)
    try:
        emb = inf(wav_path)
        arr = np.asarray(emb).reshape(-1).astype(float)
        return arr.tolist()
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass


def cosine_similarity(a, b) -> float:
    va = np.asarray(a, dtype=float).reshape(-1)
    vb = np.asarray(b, dtype=float).reshape(-1)
    if va.size == 0 or vb.size == 0 or va.size != vb.size:
        return 0.0
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0.0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def label_against_user(audio_path: str, user_embedding) -> dict:
    """
    Compute embedding for audio_path and decide USER vs OTHER.
    Returns { speaker, similarity }. If no enrolled embedding or model not
    available, returns speaker='UNKNOWN'.
    """
    if not user_embedding or not speaker_available():
        return {'speaker': 'UNKNOWN', 'similarity': 0.0}

    try:
        emb = compute_embedding(audio_path)
    except Exception as exc:
        print(f'Embedding failed: {exc}')
        return {'speaker': 'UNKNOWN', 'similarity': 0.0}

    sim = cosine_similarity(emb, user_embedding)
    speaker = 'USER' if sim >= SIM_THRESHOLD else 'OTHER'
    print(f'[speaker] similarity={sim:.3f} threshold={SIM_THRESHOLD:.2f} -> {speaker}')
    return {'speaker': speaker, 'similarity': sim, 'embedding': emb}


def _classify(sim: float) -> str:
    if sim >= SIM_HIGH:
        return 'USER'
    if sim <= SIM_LOW:
        return 'OTHER'
    return 'UNKNOWN'


def label_segments(audio_path: str, segments, user_embedding):
    """
    Embed each Whisper segment individually and label as USER/OTHER/UNKNOWN.
    This is more accurate than one whole-chunk embedding because a single
    8s chunk can contain both speakers.

    Returns a list of {speaker, similarity} dicts, same length as `segments`.
    Uses short context padding around each segment and a small smoothing pass
    to reduce USER/UNKNOWN flicker in live noisy speech.
    """
    n = len(segments)
    if n == 0 or not user_embedding or not speaker_available():
        return [{'speaker': 'UNKNOWN', 'similarity': 0.0} for _ in range(n)]

    wav_path = ensure_wav(audio_path)
    inf = _get_inference()
    results = []
    try:
        # Whole-chunk similarity acts as a weak fallback prior.
        chunk_emb = inf(wav_path)
        chunk_arr = np.asarray(chunk_emb).reshape(-1).astype(float).tolist()
        chunk_sim = cosine_similarity(chunk_arr, user_embedding)
        chunk_speaker = _classify(chunk_sim)

        for seg in segments:
            start = max(0.0, float(seg.get('start', 0.0)))
            end = float(seg.get('end', start))
            duration = end - start
            if duration < SEGMENT_MIN_DURATION:
                results.append({'speaker': 'UNKNOWN', 'similarity': 0.0})
                continue

            clip_start = max(0.0, start - SEGMENT_PAD_SEC)
            clip_end = end + SEGMENT_PAD_SEC
            slice_path = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
            try:
                subprocess.run(
                    ['ffmpeg', '-y', '-ss', f'{clip_start:.3f}', '-to', f'{clip_end:.3f}',
                     '-i', wav_path, '-ar', '16000', '-ac', '1', slice_path],
                    check=True, capture_output=True,
                )
                emb = inf(slice_path)
                arr = np.asarray(emb).reshape(-1).astype(float).tolist()
                sim = cosine_similarity(arr, user_embedding)
                spk = _classify(sim)
                print(f'[seg] {start:5.2f}-{end:5.2f}s sim={sim:+.3f} -> {spk}')
                results.append({'speaker': spk, 'similarity': sim})
            except Exception as exc:
                print(f'[seg] embed failed: {exc}')
                results.append({'speaker': 'UNKNOWN', 'similarity': 0.0})
            finally:
                try:
                    os.unlink(slice_path)
                except OSError:
                    pass

        # Temporal smoothing: if UNKNOWN is surrounded by the same label,
        # keep continuity instead of flickering.
        for i in range(1, len(results) - 1):
            if results[i]['speaker'] != 'UNKNOWN':
                continue
            left = results[i - 1]['speaker']
            right = results[i + 1]['speaker']
            if left == right and left in ('USER', 'OTHER'):
                results[i]['speaker'] = left

        # Weak fallback: if still UNKNOWN and chunk-level confidence is clearly
        # outside ambiguity band, inherit chunk speaker.
        for item in results:
            if item['speaker'] != 'UNKNOWN':
                continue
            if chunk_speaker == 'USER' and chunk_sim >= (SIM_HIGH + 0.04):
                item['speaker'] = 'USER'
                item['similarity'] = chunk_sim
            elif chunk_speaker == 'OTHER' and chunk_sim <= (SIM_LOW - 0.04):
                item['speaker'] = 'OTHER'
                item['similarity'] = chunk_sim
    finally:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
    return results

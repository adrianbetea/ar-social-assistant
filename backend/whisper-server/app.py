import os
import sys
import tempfile
import base64
import json
import traceback
import unicodedata

from flask import Flask, request, jsonify
from flask_cors import CORS

# Add the whisper package from the backend directory
WHISPER_PATH = os.path.join(os.path.dirname(__file__), '..', 'whisper')
sys.path.insert(0, WHISPER_PATH)

import whisper
import speaker as speaker_mod

app = Flask(__name__)
CORS(app)

MODEL_NAME = os.environ.get('WHISPER_MODEL', 'base')
model = None


def get_model():
    global model
    if model is None:
        print(f'Loading Whisper model: {MODEL_NAME}')
        model = whisper.load_model(MODEL_NAME)
        print('Whisper model loaded.')
    return model


def read_audio_from_request():
    """Returns (audio_bytes, extras_dict) or (None, flask_error_response)."""
    if request.content_type and 'multipart/form-data' in request.content_type:
        audio_file = request.files.get('audio')
        if not audio_file:
            return None, (jsonify({'error': 'No audio file provided.'}), 400)
        data = audio_file.read()
        extras = {k: request.form.get(k) for k in request.form.keys()}
        return data, extras

    body = request.get_json(silent=True) or {}
    audio_b64 = body.get('audioBase64')
    if not audio_b64:
        return None, (jsonify({'error': 'No audioBase64 provided.'}), 400)
    try:
        if ',' in audio_b64:
            audio_b64 = audio_b64.split(',', 1)[1]
        data = base64.b64decode(audio_b64)
    except Exception:
        return None, (jsonify({'error': 'Invalid base64 audio.'}), 400)
    extras = {k: v for k, v in body.items() if k != 'audioBase64'}
    return data, extras


def save_temp_audio(audio_data: bytes, suffix: str = '.webm') -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_data)
        return tmp.name


# Common Whisper hallucination patterns (from training on YouTube subtitles, etc.)
_HALLUCINATION_PHRASES = {
    'thanks for watching', 'thank you for watching', 'subscribe to my channel',
    'please subscribe', 'like and subscribe', 'see you next time',
    'thank you.', 'thanks.', 'you', '.', 'bye.', 'bye bye.',
}

_SCRIPT_KEYWORDS = ('LATIN', 'CYRILLIC', 'HANGUL', 'CJK', 'HIRAGANA',
                    'KATAKANA', 'ARABIC', 'HEBREW', 'GREEK', 'DEVANAGARI',
                    'THAI', 'ARMENIAN')


def _detect_scripts(text: str):
    scripts = set()
    for ch in text:
        if not ch.isalpha():
            continue
        try:
            name = unicodedata.name(ch, '')
        except Exception:
            continue
        for key in _SCRIPT_KEYWORDS:
            if key in name:
                scripts.add(key)
                break
    return scripts


def looks_like_hallucination(text: str) -> bool:
    if not text:
        return True
    stripped = text.strip()
    if len(stripped) < 2:
        return True
    if stripped.lower() in _HALLUCINATION_PHRASES:
        return True
    # Mixed alphabets in the same short utterance = Whisper hallucinated
    scripts = _detect_scripts(stripped)
    if len(scripts) >= 2:
        return True
    return False


def transcribe_file(path: str, language=None, task: str = 'transcribe'):
    m = get_model()
    options = {
        'task': task,
        'condition_on_previous_text': False,
        'no_speech_threshold': 0.6,
        'compression_ratio_threshold': 2.4,
        'logprob_threshold': -1.0,
    }
    if language:
        options['language'] = language
    result = m.transcribe(path, **options)
    segments = result.get('segments', [])
    filtered = []
    for s in segments:
        if s.get('no_speech_prob', 0) >= 0.6:
            continue
        if s.get('avg_logprob', 0) < -0.8:
            continue
        if s.get('compression_ratio', 0) > 2.4:
            continue
        seg_text = s.get('text', '').strip()
        if looks_like_hallucination(seg_text):
            continue
        filtered.append(s)

    text = ' '.join(s['text'].strip() for s in filtered).strip()
    if looks_like_hallucination(text):
        text = ''
        filtered = []

    return {
        'text': text,
        'language': result.get('language', ''),
        'segments': [
            {'start': s['start'], 'end': s['end'], 'text': s['text'].strip()}
            for s in filtered
        ],
    }


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok': True,
        'model': MODEL_NAME,
        'speakerIdAvailable': speaker_mod.speaker_available(),
    })


@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    audio_data, extras_or_err = read_audio_from_request()
    if audio_data is None:
        return extras_or_err
    extras = extras_or_err

    if len(audio_data) < 100:
        return jsonify({'error': 'Audio data too short.'}), 400

    tmp_path = save_temp_audio(audio_data, '.webm')
    try:
        result = transcribe_file(
            tmp_path,
            language=extras.get('language'),
            task=extras.get('task', 'transcribe'),
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route('/enroll', methods=['POST'])
def enroll_voice():
    """Compute and return a speaker embedding for the provided audio."""
    if not speaker_mod.speaker_available():
        return jsonify({
            'error': 'Speaker identification unavailable. Set HF_TOKEN and accept '
                     'pyannote/embedding model terms on Hugging Face.',
        }), 503

    audio_data, extras_or_err = read_audio_from_request()
    if audio_data is None:
        return extras_or_err

    if len(audio_data) < 2000:
        return jsonify({'error': 'Enrollment audio too short (need ~5-15s of speech).'}), 400

    tmp_path = save_temp_audio(audio_data, '.webm')
    try:
        embedding = speaker_mod.compute_embedding(tmp_path)
        return jsonify({'embedding': embedding, 'dim': len(embedding)})
    except Exception as e:
        print('[/enroll] ERROR:', repr(e))
        traceback.print_exc()
        return jsonify({'error': str(e) or e.__class__.__name__}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route('/diarize-transcribe', methods=['POST'])
def diarize_transcribe():
    """
    Transcribe + identify speaker against an enrolled user embedding.

    JSON body:
      audioBase64 (required), userEmbedding (JSON array, required for labeling),
      language (optional), task (optional).

    Returns: { text, language, speaker, similarity, segments:[{...,speaker}] }
    """
    audio_data, extras_or_err = read_audio_from_request()
    if audio_data is None:
        return extras_or_err
    extras = extras_or_err

    if len(audio_data) < 100:
        return jsonify({'error': 'Audio data too short.'}), 400

    user_embedding = extras.get('userEmbedding')
    if isinstance(user_embedding, str):
        try:
            user_embedding = json.loads(user_embedding)
        except Exception:
            user_embedding = None

    tmp_path = save_temp_audio(audio_data, '.webm')
    try:
        # Transcribe first -- we need Whisper's segment boundaries to embed
        # each segment individually (more accurate than one embedding for the
        # whole chunk, since one chunk often contains both speakers).
        result = transcribe_file(
            tmp_path,
            extras.get('language'),
            extras.get('task', 'transcribe'),
        )

        chunk_speaker = 'UNKNOWN'
        chunk_sim = 0.0
        can_label = (
            user_embedding
            and speaker_mod.speaker_available()
            and result['text']
            and result['segments']
        )
        if can_label:
            try:
                seg_labels = speaker_mod.label_segments(
                    tmp_path, result['segments'], user_embedding
                )
            except Exception as exc:
                print(f'Per-segment labeling failed: {exc}')
                traceback.print_exc()
                seg_labels = [
                    {'speaker': 'UNKNOWN', 'similarity': 0.0}
                    for _ in result['segments']
                ]
            for seg, lbl in zip(result['segments'], seg_labels):
                seg['speaker'] = lbl['speaker']

            # Chunk label should reflect dominant segment speaker, not the
            # single highest-score segment (which can be noisy).
            count_user = sum(1 for l in seg_labels if l.get('speaker') == 'USER')
            count_other = sum(1 for l in seg_labels if l.get('speaker') == 'OTHER')
            if count_user > count_other and count_user > 0:
                chunk_speaker = 'USER'
                sims = [l.get('similarity', 0.0) for l in seg_labels if l.get('speaker') == 'USER']
                chunk_sim = float(sum(sims) / max(1, len(sims)))
            elif count_other > count_user and count_other > 0:
                chunk_speaker = 'OTHER'
                sims = [l.get('similarity', 0.0) for l in seg_labels if l.get('speaker') == 'OTHER']
                chunk_sim = float(sum(sims) / max(1, len(sims)))
            else:
                chunk_speaker = 'UNKNOWN'
                chunk_sim = 0.0
        else:
            for seg in result['segments']:
                seg['speaker'] = 'UNKNOWN'

        return jsonify({
            **result,
            'speaker': chunk_speaker,
            'similarity': chunk_sim,
        })
    except Exception as e:
        print('[/diarize-transcribe] ERROR:', repr(e))
        traceback.print_exc()
        return jsonify({'error': str(e) or e.__class__.__name__}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == '__main__':
    port = int(os.environ.get('WHISPER_PORT', 5001))
    get_model()
    app.run(host='0.0.0.0', port=port, debug=False)

import os
import sys
import tempfile
import base64

from flask import Flask, request, jsonify
from flask_cors import CORS

# Add the whisper package from the backend directory
WHISPER_PATH = os.path.join(os.path.dirname(__file__), '..', 'whisper')
sys.path.insert(0, WHISPER_PATH)

import whisper

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


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'model': MODEL_NAME})


@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """
    Accepts audio as:
      - multipart file upload (field: 'audio')
      - JSON with base64-encoded audio (field: 'audioBase64')
    
    Optional params:
      - language: source language hint (e.g., 'en', 'ro')
      - task: 'transcribe' (default) or 'translate' (translates to English)
    """
    audio_data = None
    task = 'transcribe'
    language = None

    if request.content_type and 'multipart/form-data' in request.content_type:
        audio_file = request.files.get('audio')
        if not audio_file:
            return jsonify({'error': 'No audio file provided.'}), 400
        audio_data = audio_file.read()
        task = request.form.get('task', 'transcribe')
        language = request.form.get('language')
    else:
        body = request.get_json(silent=True) or {}
        audio_b64 = body.get('audioBase64')
        if not audio_b64:
            return jsonify({'error': 'No audioBase64 provided.'}), 400
        try:
            # Strip data URI prefix if present
            if ',' in audio_b64:
                audio_b64 = audio_b64.split(',', 1)[1]
            audio_data = base64.b64decode(audio_b64)
        except Exception:
            return jsonify({'error': 'Invalid base64 audio.'}), 400
        task = body.get('task', 'transcribe')
        language = body.get('language')

    if not audio_data or len(audio_data) < 100:
        return jsonify({'error': 'Audio data too short.'}), 400

    # Use .webm suffix for web recordings, .wav otherwise
    suffix = '.webm'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name

    try:
        m = get_model()
        options = {
            'task': task,
            'condition_on_previous_text': False,  # Prevents hallucination cascading
            'no_speech_threshold': 0.6,           # Higher = stricter silence detection
            'compression_ratio_threshold': 2.4,   # Reject garbled/repetitive output
            'logprob_threshold': -1.0,            # Reject low-confidence output
        }
        if language:
            options['language'] = language

        result = m.transcribe(tmp_path, **options)

        # Filter out hallucinated segments (high no_speech_prob)
        segments = result.get('segments', [])
        filtered_segments = [
            seg for seg in segments
            if seg.get('no_speech_prob', 0) < 0.6
        ]

        # Build text from only the filtered (non-hallucinated) segments
        filtered_text = ' '.join(seg['text'].strip() for seg in filtered_segments).strip()

        return jsonify({
            'text': filtered_text,
            'language': result.get('language', ''),
            'segments': [
                {
                    'start': seg['start'],
                    'end': seg['end'],
                    'text': seg['text'].strip(),
                }
                for seg in filtered_segments
            ],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        os.unlink(tmp_path)


if __name__ == '__main__':
    port = int(os.environ.get('WHISPER_PORT', 5001))
    # Pre-load the model
    get_model()
    app.run(host='0.0.0.0', port=port, debug=False)

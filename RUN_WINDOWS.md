# Update — DB + Whisper nou

## 1. DB: adaugă coloanele pentru voce + source_language

În MySQL Workbench, rulează pe DB-ul existent:
```sql
USE ar_social_assistant;

ALTER TABLE users
  ADD COLUMN voice_embedding LONGTEXT NULL,
  ADD COLUMN voice_enrolled_at TIMESTAMP NULL;

ALTER TABLE user_configs
  ADD COLUMN source_language VARCHAR(50) DEFAULT 'English';
```
(Dacă vreuna există deja, ignoră eroarea „Duplicate column”.)

## 2. Whisper-server nou (cu speaker ID)

Adaugă/verifică în `backend\.env`:
```env
WHISPER_URL=http://localhost:5001
HF_TOKEN=<token_dupa_accept_pyannote_embedding>
```
Token: https://huggingface.co/settings/tokens după ce accepți termenii la https://hf.co/pyannote/embedding.

Instalare (o singură dată, PowerShell):
```powershell
cd backend\whisper-server
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -U pip
pip install -r requirements.txt
```

Pornire (zilnic):
```powershell
cd backend\whisper-server
.\venv\Scripts\Activate.ps1
$env:HF_TOKEN="<hf_token>"
$env:WHISPER_MODEL="small"
python app.py
```

Prima rulare descarcă Whisper `small` (~460MB) + pyannote/embedding (~96MB) în `%USERPROFILE%\.cache\`.

Test:
```powershell
curl http://localhost:5001/health
# {"model":"small","ok":true,"speakerIdAvailable":true}
```

## 3. Enroll voce
În app: Profile → Clear Voiceprint → Enroll Voice (~12s vorbire clară).

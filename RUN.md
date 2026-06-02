# RUN.md — Setup pe laptop nou

Ghid pas cu pas pentru a porni complet aplicația pe un laptop curat.
Se presupune că **Node 20 este deja instalat**.

---

## 1. Cerințe sistem

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg mysql-server
```

Verifică:
```bash
node -v        # ar trebui v20.x
python3 --version
ffmpeg -version | head -n 1
mysql --version
```

---

## 2. Clonează repo

```bash
mkdir -p ~/MasterAn1Sem2 && cd ~/MasterAn1Sem2
git clone <URL_REPO> ar-social-assistant
cd ar-social-assistant
```

---

## 3. MySQL — pornire + user

```bash
sudo service mysql start
sudo mysql
```

În promptul MySQL:
```sql
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root';
FLUSH PRIVILEGES;
EXIT;
```

(Folosim `root/root` pentru că asta caută `.env` implicit. Schimbă dacă vrei alte credentials și actualizează `.env`.)

---

## 4. Importă schema bazei de date

```bash
mysql -uroot -proot < backend/db-schema.sql
```

Asta creează:
- DB `ar_social_assistant`
- Tabela `users` (cu `voice_embedding` + `voice_enrolled_at`)
- Tabela `user_configs`
- Tabela `interaction_logs`

### Dacă vrei să muți și datele de pe laptopul vechi

Pe laptopul vechi:
```bash
mysqldump -uroot -proot ar_social_assistant > ~/ar_social_assistant.sql
```

Transferă fișierul `ar_social_assistant.sql` pe laptopul nou și rulează:
```bash
mysql -uroot -proot ar_social_assistant < ~/ar_social_assistant.sql
```

### Dacă imporți un dump vechi care nu are coloanele de voce

```sql
USE ar_social_assistant;
ALTER TABLE users
  ADD COLUMN voice_embedding LONGTEXT NULL,
  ADD COLUMN voice_enrolled_at TIMESTAMP NULL;
```

### Dacă imporți un dump vechi fără `source_language` în `user_configs`

```sql
ALTER TABLE user_configs
  ADD COLUMN source_language VARCHAR(50) DEFAULT 'English';
```

---

## 5. Backend (Node) — `.env` + install

```bash
cd ~/MasterAn1Sem2/ar-social-assistant/backend
npm install
```

Creează `backend/.env`:
```env
PORT=3000

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=ar_social_assistant

# JWT (orice string)
JWT_SECRET=some-strong-secret-here

# Whisper server local
WHISPER_URL=http://localhost:5001

# Tokens — GENEREAZA NOI PE CONTUL TAU
GITHUB_TOKEN=<pat_github_models_cu_scope_models:read>
HF_TOKEN=<hf_token_dupa_ce_accepti_pyannote_embedding>

# Opțional
GEMINI_API_KEY=
LIBRE_TRANSLATE_ENABLED=false
LIBRE_TRANSLATE_URL=
```

**Tokens (obligatoriu de generat pe contul tău, nu se copiază între device-uri sigur):**
- `GITHUB_TOKEN`: https://github.com/settings/tokens → fine-grained → scope `models:read`
- `HF_TOKEN`: https://huggingface.co/settings/tokens → după ce accepți termenii la https://hf.co/pyannote/embedding

Pornește backend:
```bash
npm run dev
```

Test rapid:
```bash
curl -s http://localhost:3000/api/ai/health
# {"ok":true,"githubModelsConfigured":true,...}
```

---

## 6. Whisper-server (Python + pyannote)

În alt terminal:
```bash
cd ~/MasterAn1Sem2/ar-social-assistant/backend/whisper-server
python3 -m venv venv
source venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

Pornire (citește `HF_TOKEN` din `backend/.env`):
```bash
set -a; source ../.env; set +a
WHISPER_MODEL=small python app.py
```

Prima rulare descarcă în `~/.cache/`:
- model Whisper `small` (~460MB)
- model pyannote/embedding (~96MB)

Test:
```bash
curl -s http://localhost:5001/health
# {"model":"small","ok":true,"speakerIdAvailable":true}
```

### Tuning opțional la pornire

```bash
# Recunoaștere voce mai strictă / mai permisivă
SPEAKER_SIM_HIGH=0.30 SPEAKER_SIM_LOW=0.18 \
WHISPER_MODEL=small python app.py

# Model mai mare (mai bun pe limbi non-engleze, mai lent)
WHISPER_MODEL=medium python app.py
```

---

## 7. Frontend (Expo)

În alt terminal:
```bash
cd ~/MasterAn1Sem2/ar-social-assistant/frontend
npm install
```

Află IP-ul local (pentru acces de pe telefon din aceeași rețea):
```bash
ip -4 addr | grep inet | grep -v 127.0.0.1
```

Setează URL-ul backend-ului pentru frontend:
```bash
export EXPO_PUBLIC_API_URL=http://<IP_LAPTOP>:3000
```

Pornește:
```bash
npx expo start --offline -c
```

- **Web**: deschide URL-ul afișat (de obicei `http://localhost:8081`).
- **Telefon**: scanează QR-ul cu app-ul Expo Go (telefonul trebuie pe aceeași rețea cu laptopul).

---

## 8. Reînrolarea vocii (recomandat pe laptop nou)

Microfonul + camera de pe noul laptop schimbă semnătura vocală.
În aplicație:
1. Login.
2. Profile → **Clear Voiceprint**.
3. **Enroll Voice** → vorbește 12s clar, fără pauze lungi, fără zgomot.

Verifică în consola whisper-server că apar linii de tip:
```
[seg] 0.30-2.10s sim=+0.421 -> USER
```

---

## 9. Pornire zilnică (după ce ai setat totul o dată)

3 terminale:

**Terminal 1 — MySQL** (dacă nu pornește auto):
```bash
sudo service mysql start
```

**Terminal 2 — Whisper server:**
```bash
cd ~/MasterAn1Sem2/ar-social-assistant/backend/whisper-server
source venv/bin/activate
set -a; source ../.env; set +a
WHISPER_MODEL=small python app.py
```

**Terminal 3 — Backend Node:**
```bash
cd ~/MasterAn1Sem2/ar-social-assistant/backend
npm run dev
```

**Terminal 4 — Frontend:**
```bash
cd ~/MasterAn1Sem2/ar-social-assistant/frontend
export EXPO_PUBLIC_API_URL=http://<IP_LAPTOP>:3000
npx expo start --offline -c
```

---

## 10. Troubleshooting rapid

| Simptom | Cauză probabilă | Soluție |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5001` | Whisper-server nu rulează | Pornește pas 6 / 9 |
| `ECONNREFUSED 127.0.0.1:5000` | LibreTranslate nu e pornit | Lasă `LIBRE_TRANSLATE_ENABLED=false` |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL oprit | `sudo service mysql start` |
| `HF_TOKEN not set` | Lipsește din `.env` | Setează `HF_TOKEN` și accept termenii pyannote |
| AI nu răspunde / 401 | `GITHUB_TOKEN` invalid sau lipsește scope `models:read` | Regenerează tokenul |
| Toate liniile = `UNKNOWN` | Embedding făcut pe alt mic | Re-enroll voce |
| Whisper transcribe e haos | Folosești `WHISPER_MODEL=base` pe alte limbi decât EN | Trece pe `small` sau `medium` |
| Telefonul nu vede backend | Firewall sau rețea diferită | Verifică IP și deschide portul 3000 |

---

## 11. Ce NU se transferă între laptopuri

- `GITHUB_TOKEN` — generează unul nou pe contul tău
- `HF_TOKEN` — generează unul nou + accept termeni pyannote/embedding
- `voice_embedding` din DB — funcționează tehnic, dar e legat de microfonul vechi → recomand re-enroll
- Cache modele Whisper/pyannote din `~/.cache/` — se redescarcă automat

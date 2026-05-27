# JurisGuard Setup Guide

JurisGuard is a PAO legal document extraction system built with a React/Vite frontend, FastAPI backend, PostgreSQL database, PaddleOCR, OpenCV, and a rule-based spaCy/Regex NLP extraction layer.

This guide explains how to run the project locally after cloning it from GitHub.

## 1. Requirements

Install these first:

- Python 3.10 or newer
- Node.js 20 or newer
- PostgreSQL 14 or newer
- Git
- A webcam, optional, for live scanning

Recommended for Windows:

- PowerShell
- pgAdmin or PostgreSQL command line tools

## 2. Clone the Repository

```powershell
git clone https://github.com/YOUR_USERNAME/JurisGuard1.git
cd JurisGuard1
```

Replace `YOUR_USERNAME` with the GitHub account or organization name.

## 3. Environment File

Copy the sample environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and update the database password:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/jurisguard
FRONTEND_ORIGIN=http://localhost:5173
UPLOAD_DIR=uploads
MISTRAL_API_KEY=
VITE_API_BASE_URL=http://localhost:8000
PADDLEOCR_MAX_DIMENSION=1600
PADDLEOCR_DET_LIMIT_SIDE_LEN=960
PADDLEOCR_DET_MODEL_NAME=PP-OCRv4_mobile_det
PADDLEOCR_REC_MODEL_NAME=en_PP-OCRv4_mobile_rec
PADDLEOCR_ENABLE_ANGLE_CLS=false
PADDLEOCR_ENHANCED_PREPROCESS=false
PADDLEOCR_CPU_THREADS=4
PADDLEOCR_ENABLE_MKLDNN=false
PADDLEOCR_USE_GPU=false
PAO_CHECKBOX_MODE=strict
PAO_SPACY_DEBUG=false
```

Notes:

- Leave `MISTRAL_API_KEY` blank if you only want the offline PaddleOCR + spaCy pipeline.
- `PAO_CHECKBOX_MODE=strict` prevents printed checkbox labels from being treated as selected options.
- Do not upload `.env` to GitHub. The repository already ignores it.

## 4. PostgreSQL Setup

Create a database named `jurisguard`.

Using pgAdmin:

1. Open pgAdmin.
2. Connect to your PostgreSQL server.
3. Create a new database named `jurisguard`.

Using command line:

```powershell
createdb -U postgres jurisguard
```

When the FastAPI backend starts, SQLAlchemy will create the required tables automatically.

## 5. Backend Setup

Go to the backend folder:

```powershell
cd backend
```

Create a virtual environment:

```powershell
python -m venv venv
```

Activate it:

```powershell
.\venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again:

```powershell
.\venv\Scripts\Activate.ps1
```

Install Python dependencies:

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Start the backend:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend URLs:

- API root: `http://127.0.0.1:8000`
- Health check: `http://127.0.0.1:8000/health`
- Swagger UI: `http://127.0.0.1:8000/docs`

Important: run `uvicorn main:app` from inside the `backend` folder. Running it from the wrong folder may cause:

```text
Error loading ASGI app. Could not import module "main".
```

## 6. Frontend Setup

Open a new terminal at the project root, then run:

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

If Vite uses another port, open the URL shown in the terminal.

## 7. Create an Admin Account

You can register through the app, or create an admin account directly in PostgreSQL.

Example SQL:

```sql
BEGIN;

INSERT INTO public.role (role_name, permissions)
SELECT 'admin', 'all'
WHERE NOT EXISTS (
    SELECT 1 FROM public.role WHERE role_name = 'admin'
);

INSERT INTO public."user" (
    role_id,
    username,
    email,
    full_name,
    password_hash,
    approval_status,
    is_active,
    mfa_enabled,
    profile_completed
)
SELECT
    role_id,
    'admin',
    'admin@jurisguard.local',
    'System Administrator',
    'admin123',
    'approved',
    true,
    false,
    true
FROM public.role
WHERE role_name = 'admin'
ORDER BY role_id
LIMIT 1
ON CONFLICT (username) DO UPDATE
SET
    role_id = EXCLUDED.role_id,
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    password_hash = 'admin123',
    approval_status = 'approved',
    is_active = true,
    profile_completed = true;

COMMIT;
```

Default login after running the SQL:

```text
Email: admin@jurisguard.local
Password: admin123
```

For production, replace this password immediately.

## 8. OCR Pipeline Notes

JurisGuard supports two document extraction paths:

1. Cloud pipeline, if `MISTRAL_API_KEY` is configured.
2. Offline pipeline, using PaddleOCR + spaCy/Regex, if cloud extraction is unavailable or not configured.

Offline pipeline flow:

```text
Uploaded image
  -> OpenCV/Pillow preprocessing
  -> PaddleOCR text detection and recognition
  -> spaCy EntityRuler/Matcher
  -> Regex field mapping
  -> JSON extraction result
  -> PostgreSQL metadata storage
```

The offline pipeline is deterministic. It does not train on the uploaded form. It uses strict rules for Filipino PAO labels such as:

- `Petsa` -> Form Date
- `Control No.` -> Control Number
- `Rehiyon` -> Region
- `District Office` -> District Office
- `Pangalan` -> Applicant or representative name depending on section context

## 9. Live Scanner

The repository includes `live_scanner.py`, a standalone OpenCV scanner for webcam-based document capture.

Run it from the project root:

```powershell
python live_scanner.py
```

Basic controls:

- Move the PAO form in front of the camera.
- The scanner detects the paper boundary.
- Press `SPACEBAR` to capture and flatten the document.
- The output image is saved as `temp_live_scan.jpg`.

If the camera shows a blank or green frame:

- Close other apps using the camera.
- Restart the scanner.
- Try another camera index in the script if multiple cameras are connected.
- Check Windows camera privacy settings.

## 10. Common Commands

Backend:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm run dev
```

Frontend checks:

```powershell
cd frontend
npm run typecheck
npm run lint
npm run build
```

Backend syntax check:

```powershell
cd backend
python -m py_compile main.py models.py database.py ai_service.py
```

## 11. Troubleshooting

### Uvicorn says unexpected extra arguments

Wrong:

```powershell
uvicorn main:app --reload host 127.0.0.1 --port 8000
```

Correct:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Could not import module main

Run the backend from the `backend` folder:

```powershell
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### PostgreSQL password authentication failed

Check the `DATABASE_URL` in `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/jurisguard
```

Make sure:

- PostgreSQL is running.
- The password is correct.
- The `jurisguard` database exists.

### Frontend cannot connect to backend

Check that the backend is running at:

```text
http://127.0.0.1:8000
```

Then check `.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Restart the frontend after changing environment variables.

### OCR is slow

The offline OCR layer can be CPU-heavy. You can try:

```env
PADDLEOCR_MAX_DIMENSION=1200
PADDLEOCR_DET_LIMIT_SIDE_LEN=736
PADDLEOCR_ENABLE_ANGLE_CLS=false
PADDLEOCR_ENHANCED_PREPROCESS=false
```

Lower values are faster but may reduce accuracy on small or blurry handwriting.

## 12. Before Uploading to GitHub

Check that these are not committed:

- `.env`
- `backend/venv/`
- `frontend/node_modules/`
- `uploads/`
- scanned client documents
- PostgreSQL dumps containing real personal data

Safe files to commit:

- `.env.example`
- `backend/requirements.txt`
- frontend source files
- backend source files
- `setup.md`
- sanitized sample data only

## 13. Recommended Development Order

1. Start PostgreSQL.
2. Start FastAPI backend.
3. Start React frontend.
4. Log in as admin.
5. Create or select a client.
6. Upload or scan a PAO form.
7. Review extracted fields.
8. Save the case.

This keeps the workflow close to the final JurisGuard capstone demonstration.

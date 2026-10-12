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
VITE_API_BASE_URL=http://localhost:8000/api
LOCAL_OCR_MAX_DIMENSION=2500
LOCAL_OCR_MAX_PAGES=8
LOCAL_OCR_MAX_PIXELS=40000000
PAO_CHECKBOX_MODE=strict
PAO_SPACY_DEBUG=false
```

Notes:

- `auto` and `offline` extraction run locally even when `MISTRAL_API_KEY` is set. Cloud extraction requires the explicit `cloud` mode.
- PaddleOCR uses existing local model directories and does not download models at runtime. See [offline extraction testing](docs/offline_extraction_testing.md) for model paths and commands.
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

On a fresh database, generate a unique random setup key (at least 32 characters) and set `ADMIN_BOOTSTRAP_KEY` **on the backend only**, before starting the API. Register the first account through the application and enter that key in the optional initial admin setup field. The backend assigns the first account the admin role, approves it, and hashes its password; registrations without the configured key cannot claim admin access. Once the first account exists, remove the key from the backend environment and restart. Subsequent registrations remain pending until an admin approves them; the setup field should be left blank. Never put the setup key in `VITE_` variables or commit it. Use a unique strong account password. Do not insert plaintext passwords or use shared default credentials in SQL.

## 8. OCR Pipeline Notes

JurisGuard defaults to offline PaddleOCR with a local Tesseract fallback. Cloud extraction is used only when explicitly selected.

Offline pipeline flow:

```text
Uploaded image or PDF
  -> Pillow orientation/contrast correction or local PDF rendering
  -> PaddleOCR text detection and recognition (local Tesseract fallback)
  -> weighted document router
  -> intake spaCy/Regex compatibility fields or RTC decision rules
  -> exact inventory plus separate evidence and review diagnostics
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
VITE_API_BASE_URL=http://localhost:8000/api
```

Restart the frontend after changing environment variables.

### OCR is slow

The offline OCR layer can be CPU-heavy. You can try:

```env
LOCAL_OCR_MAX_DIMENSION=1800
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

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
SECRET_KEY=YOUR_PRIVATE_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS
FRONTEND_ORIGIN=http://localhost:5173
UPLOAD_DIR=uploads
MISTRAL_API_KEY=
VITE_API_BASE_URL=http://localhost:8000/api
LOCAL_OCR_MAX_DIMENSION=2500
LOCAL_OCR_DET_MAX_DIMENSION=1280
LOCAL_OCR_MAX_PAGES=8
LOCAL_OCR_MAX_PIXELS=40000000
PAO_CHECKBOX_MODE=strict
PAO_SPACY_DEBUG=false
```

Notes:

- Generate `SECRET_KEY` with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and keep it private. The backend refuses a missing or short key.
- `auto` and `offline` use local PaddleOCR. Cloud mode requires explicit selection and a configured `MISTRAL_API_KEY`.
- Place `VITE_API_BASE_URL=http://localhost:8000/api` in `frontend/.env.local` as well; Vite reads frontend variables from its own directory.
- Interactive uploads use cached PP-OCRv5 mobile detection and English/Latin recognition models for practical Windows CPU latency. PP-OCRv6 medium remains selectable with `PADDLEOCR_MODEL_PROFILE=medium` for slower accuracy experiments. See [offline extraction testing](docs/offline_extraction_testing.md) for paths and version checks.
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

On a fresh database, generate a unique random setup key of at least 32 characters and set `ADMIN_BOOTSTRAP_KEY` in the backend environment before starting the API. Register the first account through the application and enter that key in the initial admin setup field. The backend hashes the account password and approves the first administrator. Remove the bootstrap key and restart the backend after this account exists.

Do not insert a plaintext password into `password_hash` or use shared default credentials. Later registrations remain pending until an administrator approves them.

## 8. OCR Pipeline Notes

The application uses local PaddleOCR for `auto` and `offline` extraction. `cloud` is an explicit optional mode; the three OCR and three NLP comparison candidates run only in `jurisguard-extraction-lab/`.

```text
Captured image or PDF
  -> local image preparation or PDF page rendering
  -> cached PaddleOCR detection and recognition
  -> weighted document router
  -> intake spaCy/Regex fields or RTC decision rules
  -> 21-field inventory, separate diagnostics, and human review
```

The pipeline does not train on an uploaded form. A failed OCR run requires review and does not switch to a comparison engine. Test a synthetic image with:

```powershell
.\backend\venv\Scripts\python.exe backend\extract_one.py jurisguard-extraction-lab\data\synthetic\synthetic_intake.png
```

See [offline extraction testing](docs/offline_extraction_testing.md) and [manuscript comparison protocol](jurisguard-extraction-lab/MANUSCRIPT_TESTING.md).

## 9. Document Camera

Connect the overhead document camera by USB and confirm Windows lists it as a camera. In JurisGuard, choose **Document Camera** and select **Detect cameras**. Allow camera access for the exact JurisGuard address shown in the browser. Select **NETUM Camera** if that is the connected device, then select **Start document camera**. Check the displayed camera name and frame resolution before positioning the page. Select **Capture photo**, zoom in to inspect small text, and use **Retake photo** if blurred. Select **Use photo for OCR** only after the still photo appears. The preview itself does not run OCR.

If camera access is denied or remains pending, check the browser permission for the exact JurisGuard address and try **Detect cameras** again. If the device does not appear in the browser camera list, use its own scanning software to save a JPG or PNG, then choose **Upload Document**. Browser camera capture requires localhost or a secure origin and camera permission. A successful preview alone does not verify still capture and OCR; test both with the actual camera before the defense.

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
uvicorn main:app --reload --host 127.0.0.1 --port 8000
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
LOCAL_OCR_DET_MAX_DIMENSION=960
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

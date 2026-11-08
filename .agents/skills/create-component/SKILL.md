---
name: create-component
description: >-
  Create or revise a reusable React and TypeScript UI component in JurisGuard.
  Use for shared frontend components under frontend/src/components/ or
  workflow-specific modules under frontend/src/features/.
---

# Create a JurisGuard Component

1. **Choose the Right Location**:
   - Place shared primitives and modals in `frontend/src/components/`.
   - Place workflow-specific UI, step panels, and helpers in `frontend/src/features/<featureName>/` (e.g., `criminalCases/`, `documentExtraction/`, `dashboard/`, `messaging/`).
   - Keep individual component files focused and under ~1,000 lines by splitting step views, primitives, and pure helper functions into dedicated modules.
2. **Follow Accessibility & Styling Conventions**:
   - Define explicit TypeScript prop interfaces and accessible labels (`aria-label`, `role="dialog"`, keyboard handling).
   - Follow existing Tailwind CSS styling and avoid duplicating markup that can be shared cleanly.
3. **Protect Legal Data & Offline Operation**:
   - Keep legal-document content in props or local state only as needed. Never log document text to the console or add external network dependencies.
4. **Verify**:
   - From `frontend/`, run `npm run lint`, `npm run typecheck`, and `npm run build`.
   - From the repo root, run `node --test tests/frontend/*.test.cjs` to ensure UI contracts pass.

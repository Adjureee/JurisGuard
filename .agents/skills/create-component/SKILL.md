---
name: create-component
description: Create or revise a reusable React and TypeScript UI component in JurisGuard. Use for shared frontend components; use feature folders for UI that belongs to one workflow.
---

# Create a JurisGuard component

1. Inspect nearby components and the calling feature before choosing a location under `frontend/src/components/` or `frontend/src/features/`.
2. Define typed props and accessible labels or controls. Follow the existing Tailwind and component patterns; avoid copying markup that can be shared cleanly.
3. Keep legal-document content in props or state only as needed. Do not log document text or add external network dependencies.
4. Update the caller, and run `npm run typecheck` and `npm run build` from `frontend/`. Report any checks that could not run.

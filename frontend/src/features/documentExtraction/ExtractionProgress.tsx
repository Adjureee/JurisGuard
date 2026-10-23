type Props = { elapsedSeconds: number; onCancel: () => void };

export function ExtractionProgress({ elapsedSeconds, onCancel }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
      <div>
        <p role="status" className="text-sm font-semibold text-blue-900">Reading document… {elapsedSeconds}s elapsed</p>
        <p className="text-xs text-blue-800">The first scan and pages with many fields can take longer. You can cancel and enter fields manually.</p>
      </div>
      <button type="button" onClick={onCancel} className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-100">
        Cancel extraction
      </button>
    </div>
  );
}

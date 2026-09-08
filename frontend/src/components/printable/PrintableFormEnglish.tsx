import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormEnglishProps {
  template: string;
  data: PrintableFormData;
  page?: 1 | 2;
  onReady?: () => void;
}

const PrintableFormEnglish = forwardRef<HTMLIFrameElement, PrintableFormEnglishProps>(
  ({ template, data, page, onReady }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="english" page={page} onReady={onReady} />
  )
);

PrintableFormEnglish.displayName = "PrintableFormEnglish";

export default PrintableFormEnglish;


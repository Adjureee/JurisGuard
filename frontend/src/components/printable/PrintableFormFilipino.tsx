import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormFilipinoProps {
  template: string;
  data: PrintableFormData;
  page?: 1 | 2;
  onReady?: () => void;
}

const PrintableFormFilipino = forwardRef<HTMLIFrameElement, PrintableFormFilipinoProps>(
  ({ template, data, page, onReady }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="filipino" page={page} onReady={onReady} />
  )
);

PrintableFormFilipino.displayName = "PrintableFormFilipino";

export default PrintableFormFilipino;


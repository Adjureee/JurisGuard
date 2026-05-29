import { forwardRef } from "react";
import OfficialFormFrame from "./OfficialFormFrame";
import type { PrintableFormData } from "./officialFormHydrator";

interface PrintableFormFilipinoProps {
  template: string;
  data: PrintableFormData;
}

const PrintableFormFilipino = forwardRef<HTMLIFrameElement, PrintableFormFilipinoProps>(
  ({ template, data }, ref) => (
    <OfficialFormFrame ref={ref} template={template} data={data} language="filipino" />
  )
);

PrintableFormFilipino.displayName = "PrintableFormFilipino";

export default PrintableFormFilipino;


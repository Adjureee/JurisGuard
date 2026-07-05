import { motion } from "framer-motion";

interface AuthImagePanelProps {
  eyebrow?: string;
  headline: string;
  description: string;
}

export default function AuthImagePanel({
  eyebrow = "JurisGuard",
  headline,
  description,
}: AuthImagePanelProps) {
  return (
    <div className="relative hidden min-h-[600px] overflow-hidden bg-slate-950 lg:block">
      <img
        src="/loginimage.png"
        alt="JurisGuard legal operations workspace"
        className="h-full w-full object-cover opacity-90"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-slate-900/25" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-slate-950/65 to-transparent" />
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="absolute left-8 top-8 flex items-center gap-3 text-white"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 shadow-sm backdrop-blur">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
            <path
              fill="currentColor"
              d="M12 3 4 6v5c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V6l-8-3Zm0 3.2 5 1.9V11c0 3.4-2 5.8-5 7.2-3-1.4-5-3.8-5-7.2V8.1l5-1.9ZM9 10h6v2H9v-2Zm1 3h4v2h-4v-2Z"
            />
          </svg>
        </div>
        <div>
          <p className="text-base font-bold tracking-wide">{eyebrow}</p>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/70">
            PAO Panabo
          </p>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: "easeOut" }}
        className="absolute bottom-7 left-8 right-8 text-white"
      >
        <div className="mb-4 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur">
          Secure Legal Records
        </div>
        <p className="max-w-sm text-2xl font-bold leading-tight tracking-tight">{headline}</p>
        <p className="mt-3 max-w-md text-sm font-medium leading-6 text-white/75">
          {description}
        </p>
      </motion.div>
    </div>
  );
}


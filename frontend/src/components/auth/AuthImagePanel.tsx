import { motion } from "framer-motion";
import jurisguardLogo from "../../logo/jurisguard-logo.svg";

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
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 p-1.5 ring-1 ring-white/20 backdrop-blur">
          <img
            src={jurisguardLogo}
            alt="JurisGuard emblem"
            className="h-full w-full object-contain"
          />
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


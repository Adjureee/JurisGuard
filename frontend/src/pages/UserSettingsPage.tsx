import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import { useConfirmation } from "../components/ConfirmationProvider";
import { useAuth } from "../contexts/AuthContext";
import {
  disableMfa,
  enableMfa,
  forgetTrustedDevice,
  getTrustedDeviceToken,
  setupMfa,
} from "../services/authService";
import {
  defaultReminderLeadFor,
  useSettingsStore,
  type ReminderLeadMinutes,
} from "../features/settings/settingsStore";

const REMINDER_OPTIONS: { value: ReminderLeadMinutes; label: string }[] = [
  { value: null, label: "No notification" },
  { value: 0, label: "At the reminder time" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-[#CBD5E1] bg-white px-3 text-sm text-[#243244] outline-none transition focus-visible:border-[#704389] focus-visible:ring-2 focus-visible:ring-[#704389]/25";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#704389] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#334155] transition hover:bg-[#F8FAFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389] disabled:cursor-not-allowed disabled:opacity-60";

export default function UserSettingsPage() {
  const { user, getCurrentUser } = useAuth();
  const confirm = useConfirmation();
  const byUser = useSettingsStore((state) => state.byUser);
  const loadForUser = useSettingsStore((state) => state.loadForUser);
  const saveDefaultReminderLeadMinutes = useSettingsStore((state) => state.saveDefaultReminderLeadMinutes);
  const savedReminderLead = defaultReminderLeadFor(user?.user_id, byUser);
  const [reminderLeadDraft, setReminderLeadDraft] = useState<ReminderLeadMinutes>(15);
  const [reminderSaveMessage, setReminderSaveMessage] = useState("");
  const [reminderSaveError, setReminderSaveError] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [isMfaBusy, setIsMfaBusy] = useState(false);
  const [hasTrustedDevice, setHasTrustedDevice] = useState(false);

  useEffect(() => {
    if (!user?.user_id) return;
    loadForUser(user.user_id);
    setReminderLeadDraft(defaultReminderLeadFor(user.user_id, useSettingsStore.getState().byUser));
  }, [loadForUser, user?.user_id]);

  useEffect(() => {
    setHasTrustedDevice(Boolean(user?.email && getTrustedDeviceToken(user.email)));
  }, [user?.email]);

  const handleSaveReminderDefault = () => {
    if (!user?.user_id) return;
    setReminderSaveError("");
    setReminderSaveMessage("");
    try {
      saveDefaultReminderLeadMinutes(user.user_id, reminderLeadDraft);
      setReminderSaveMessage("Saved on this browser for your account.");
      toast.success("Reminder preference saved");
    } catch (error) {
      setReminderSaveError(error instanceof Error ? error.message : "Unable to save this preference. Try again.");
    }
  };

  const handleSetupMfa = async () => {
    setIsMfaBusy(true);
    setMfaQrCode("");
    setMfaCode("");
    try {
      const setup = await setupMfa();
      setMfaSecret(setup.secret);
      try {
        const { toDataURL } = await import("qrcode");
        setMfaQrCode(await toDataURL(setup.otpauth_uri, { width: 240, margin: 3, errorCorrectionLevel: "M" }));
      } catch {
        toast.error("Unable to create the QR code. You can use the setup key instead.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start MFA setup.");
    } finally {
      setIsMfaBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    setIsMfaBusy(true);
    try {
      await enableMfa(mfaCode);
      await getCurrentUser();
      setMfaCode("");
      setMfaSecret("");
      setMfaQrCode("");
      toast.success("Multi-factor authentication enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to enable MFA. Check the code and retry.");
    } finally {
      setIsMfaBusy(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!await confirm({ title: "Disable multi-factor authentication?", message: "Your account will no longer require an authenticator code when signing in.", confirmLabel: "Disable MFA" })) return;
    setIsMfaBusy(true);
    try {
      await disableMfa(mfaCode);
      await getCurrentUser();
      setMfaCode("");
      toast.success("Multi-factor authentication disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to disable MFA. Check the code and retry.");
    } finally {
      setIsMfaBusy(false);
    }
  };

  const handleForgetDevice = async () => {
    if (!user?.email || !await confirm({ title: "Forget this browser?", message: "The saved trusted-device token on this browser will be removed. Your current session will stay signed in; a future sign-in may ask for an MFA code.", confirmLabel: "Forget browser" })) return;
    try {
      forgetTrustedDevice(user.email);
      setHasTrustedDevice(false);
      toast.success("This browser is no longer remembered");
    } catch {
      toast.error("Unable to remove the remembered-device token from this browser.");
    }
  };

  return (
    <MainLayout>
      <PageHeader eyebrow="Account" title="Settings" description="Set your reminder default and manage sign-in security for this account." />

      <div className="grid max-w-5xl gap-5">
        <section aria-labelledby="reminder-settings-title" className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm sm:p-6">
          <div className="max-w-2xl">
            <h2 id="reminder-settings-title" className="text-lg font-semibold text-[#243244]">Reminder notifications</h2>
            <p className="mt-1 text-sm leading-6 text-[#526174]">Choose when new reminders should notify you. You can change the timing on any individual reminder. Existing reminders are not changed.</p>
            <label htmlFor="default-reminder-timing" className="mt-5 block text-sm font-semibold text-[#334155]">Default notification timing</label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <select id="default-reminder-timing" value={reminderLeadDraft === null ? "none" : String(reminderLeadDraft)} onChange={(event) => {
                const value = event.target.value;
                setReminderLeadDraft(value === "none" ? null : Number(value) as ReminderLeadMinutes);
                setReminderSaveMessage("");
              }} className={inputClass}>
                {REMINDER_OPTIONS.map((option) => <option key={option.value ?? "none"} value={option.value === null ? "none" : String(option.value)}>{option.label}</option>)}
              </select>
              <button type="button" onClick={handleSaveReminderDefault} disabled={!user || reminderLeadDraft === savedReminderLead} className={`${primaryButtonClass} shrink-0`}>Save preference</button>
            </div>
            <div aria-live="polite" className="mt-2 min-h-5 text-sm">
              {reminderSaveError ? <p className="text-red-700">{reminderSaveError}</p> : reminderSaveMessage ? <p className="text-emerald-700">{reminderSaveMessage}</p> : <p className="text-[#64748B]">Current default: {REMINDER_OPTIONS.find((option) => option.value === savedReminderLead)?.label ?? "15 minutes before"}. Saved on this browser for your account.</p>}
            </div>
          </div>
        </section>

        <section aria-labelledby="security-settings-title" className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm sm:p-6">
          <div className="max-w-2xl">
            <h2 id="security-settings-title" className="text-lg font-semibold text-[#243244]">Sign-in security</h2>
            <p className="mt-1 text-sm leading-6 text-[#526174]">Use an authenticator app to add a second sign-in check. Disabling it requires a current code.</p>

            <div className="mt-5 rounded-lg border border-[#E2E8F0] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-[#334155]">Multi-factor authentication</h3>
                  <p className="mt-1 text-sm text-[#526174]">Status: <span className="font-semibold">{user?.mfa_enabled ? "Enabled" : "Disabled"}</span></p>
                </div>
                {!user?.mfa_enabled && <button type="button" onClick={handleSetupMfa} disabled={isMfaBusy} className={secondaryButtonClass}>{isMfaBusy ? "Starting setup…" : "Set up authenticator"}</button>}
              </div>

              {mfaSecret && !user?.mfa_enabled && <div className="mt-4 space-y-3 border-t border-[#E2E8F0] pt-4">
                <p className="text-sm leading-6 text-[#526174]">Add JurisGuard to your authenticator app, then enter the current six-digit code to finish setup.</p>
                {mfaQrCode && <img src={mfaQrCode} alt="Authenticator setup QR code" width={240} height={240} className="h-60 w-60 max-w-full rounded-md border border-[#E2E8F0] bg-white p-2" />}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[#704389] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]">Show setup key instead</summary>
                  <p className="mt-2 break-all rounded-md bg-[#F8FAFC] p-3 font-mono text-sm text-[#243244]">{mfaSecret}</p>
                </details>
              </div>}

              {(mfaSecret || user?.mfa_enabled) && <div className="mt-4 flex flex-col gap-3 border-t border-[#E2E8F0] pt-4 sm:flex-row sm:items-end">
                <label htmlFor="mfa-verification-code" className="block flex-1 text-sm font-semibold text-[#334155]">Authenticator code
                  <input id="mfa-verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} placeholder="6-digit code" />
                </label>
                <button type="button" onClick={user?.mfa_enabled ? handleDisableMfa : handleEnableMfa} disabled={isMfaBusy || mfaCode.length !== 6} className={user?.mfa_enabled ? secondaryButtonClass : primaryButtonClass}>{isMfaBusy ? "Verifying…" : user?.mfa_enabled ? "Disable MFA" : "Enable MFA"}</button>
              </div>}
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-[#334155]">Remembered browser</h3>
                <p className="mt-1 text-sm leading-6 text-[#526174]">{hasTrustedDevice ? "This browser has a locally saved trusted-device token." : "No trusted-device token is saved for this account in this browser."}</p>
              </div>
              <button type="button" onClick={handleForgetDevice} disabled={!hasTrustedDevice} className={secondaryButtonClass}>Forget this browser</button>
            </div>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}

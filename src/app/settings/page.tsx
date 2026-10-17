import SettingsForm from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p className="meta">Bring your own AI. These settings are saved on the server and are the same in every browser.</p>
      <SettingsForm />
    </>
  );
}

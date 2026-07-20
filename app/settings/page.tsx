import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/content?tab=image");
}

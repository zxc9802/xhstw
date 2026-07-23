import { redirect } from "next/navigation";
import { getMainAppSsoLaunchUrl } from "../../lib/main-app-sso";

export default function LoginPage() {
  redirect(getMainAppSsoLaunchUrl());
}

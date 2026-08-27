import { redirect } from "next/navigation";
import { getMainAppSsoLaunchUrl, isMainAppSsoDisabled } from "../../lib/main-app-sso";

export default function LoginPage() {
  redirect(isMainAppSsoDisabled() ? "/" : getMainAppSsoLaunchUrl());
}

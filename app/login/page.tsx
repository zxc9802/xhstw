import { redirect } from "next/navigation";

export default function LoginPage() {
  redirect("/content?tab=image");
}

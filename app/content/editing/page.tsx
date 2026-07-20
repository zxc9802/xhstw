import { redirect } from "next/navigation";

export default function EditingPage() {
  redirect("/content?tab=image");
}

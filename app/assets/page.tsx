import { redirect } from "next/navigation";

export default function AssetsEntryPage() {
  redirect("/templates?view=materials");
}

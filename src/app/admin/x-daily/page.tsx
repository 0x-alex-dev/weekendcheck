import { readXDaily } from "@/lib/x-daily-store";
import { XDaily } from "@/components/admin/x-daily";

export default async function XDailyPage() { return <XDaily view={await readXDaily()} />; }

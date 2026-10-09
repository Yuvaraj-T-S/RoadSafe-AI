import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && key && !url.includes("YOUR_PROJECT")
  ? createClient(url, key)
  : null;

export async function saveAccidents(records: Array<Record<string, unknown>>) {
  if (!supabase) throw new Error("Supabase is not configured yet. Local demo remains available.");
  const { error } = await supabase.from("accidents").upsert(records, { onConflict: "accident_id" });
  if (error) throw error;
}

import { redirect } from 'next/navigation';

// The handoff names the sign-in route /login; production keeps /signin (D2). Forward with the query intact.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, x);
  const s = q.toString(); redirect('/signin' + (s ? '?' + s : ''));
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import ShootView from "@/components/ShootView";
import { dbConfigured, loadShoot } from "@/lib/db";

export default function ShootPage({ params }: PageProps<"/shoot/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <Link href="/" className="text-sm text-muted">
        ← New plan
      </Link>
      <Suspense fallback={<p className="text-muted">Loading shoot…</p>}>
        <Shoot params={params} />
      </Suspense>
    </main>
  );
}

async function Shoot({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!dbConfigured()) notFound();
  const found = await loadShoot(id);
  if (!found) notFound();
  const { shoot, spots } = found;
  return <ShootView shootId={id} label={shoot.label} localTime={shoot.localTime} timezone={shoot.timezone} spots={spots} />;
}

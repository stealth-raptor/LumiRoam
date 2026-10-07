import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import WalkDiaryView from "@/components/WalkDiaryView";
import { dbConfigured } from "@/lib/db";
import { walkDiary } from "@/lib/walk";

export default function WalkDiaryPage({ params }: PageProps<"/walk/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <Suspense fallback={<p className="text-muted">Loading walk…</p>}>
        <Diary params={params} />
      </Suspense>
    </main>
  );
}

async function Diary({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!dbConfigured()) notFound();
  const diary = await walkDiary(id);
  if (!diary) notFound();
  return <WalkDiaryView diary={diary} />;
}

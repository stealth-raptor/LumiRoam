import { Suspense } from "react";
import WalkMode from "@/components/WalkMode";

export default function WalkPage({ searchParams }: PageProps<"/walk">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Walk searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Walk({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { shoot } = await searchParams;
  return <WalkMode shootId={typeof shoot === "string" ? shoot : null} />;
}

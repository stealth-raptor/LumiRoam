import PlanForm from "@/components/PlanForm";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">LumiRoam</h1>
        <p className="text-muted">
          Most tour guides tell you about a building. This one tells you how and when to photograph it. Plan here, then put
          your phone in your pocket and walk.
        </p>
      </header>
      <PlanForm />
      <footer className="text-xs text-muted">
        Open at the core: Gemma 4 and FLUX.1 [schnell] (open weights), Mastra, OpenStreetMap, Wikipedia, Wikimedia Commons. Shoots, drawings, voice clips and walks live in MongoDB Atlas.
      </footer>
    </main>
  );
}

import Calculator from "@/components/Calculator";

export default function Home() {
  return (
    <div className="page-shell flex flex-col flex-1">
      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12 md:py-16">
        <header>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
            Binance P2P · Paraguay
          </p>
          <h1 className="brand">
            PYG<span>P2P</span>
          </h1>
          <p className="tagline mt-5">
            Mix trusted merchants with checkboxes until your USDT amount is
            covered — uncheck anyone you do not trust and pick another.
          </p>
        </header>

        <Calculator />
      </main>
    </div>
  );
}

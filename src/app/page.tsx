import Calculator from "@/components/Calculator";

export default function Home() {
  return (
    <div className="page-shell flex flex-col flex-1">
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-10 px-6 py-16 md:flex-row md:items-end md:gap-16 md:py-24">
        <header className="md:flex-1 md:pb-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
            Binance P2P · Paraguay
          </p>
          <h1 className="brand">
            PYG<span>P2P</span>
          </h1>
          <p className="tagline mt-5">
            Enter USDT or PYG and get a live quote from trusted Binance
            merchants only — no random sellers.
          </p>
        </header>

        <div className="md:w-[min(100%,28rem)] md:shrink-0">
          <Calculator />
        </div>
      </main>
    </div>
  );
}

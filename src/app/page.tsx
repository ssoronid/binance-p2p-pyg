import Calculator from "@/components/Calculator";

export default function Home() {
  return (
    <div className="page-shell flex flex-col flex-1">
      <header className="top-nav">
        <div className="top-nav-inner">
          <div className="top-nav-brand">
            <h1 className="brand-nav">
              PYG<span>P2P</span>
            </h1>
            <p className="top-nav-sub">Binance P2P · Paraguay</p>
          </div>
          <p className="top-nav-hint">
            Mix trusted merchants until your USDT is covered
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-5 md:py-6">
        <Calculator />
      </main>
    </div>
  );
}

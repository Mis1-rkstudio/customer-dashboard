// app/page.tsx
import React, { JSX } from "react";
import ClientCarouselWrapper from "@/components/ClientCarouselWrapper";

export default function Home(): JSX.Element {
  return (
    <div className="min-h-screen bg-black/95 text-white">
      <header className="w-full max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">New designs</h1>
        </div>
      </header>

      <main className="w-full max-w-6xl mx-auto px-6 pb-16">
        {/* use the client wrapper — this is a server component importing a client wrapper */}
        <ClientCarouselWrapper autoplay visibleCount={3} />
      </main>

      <footer className="w-full max-w-6xl mx-auto px-6 pb-8 text-sm text-gray-400">
        <div>© {new Date().getFullYear()} Your Company</div>
      </footer>
    </div>
  );
}

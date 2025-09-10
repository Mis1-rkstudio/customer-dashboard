// app/items/page.tsx  (client component)
"use client";
import React, { Suspense } from "react";
import OrdersPage from "./OrdersPage"; // or paste your ItemsPage code here

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OrdersPage />
    </Suspense>
  );
}

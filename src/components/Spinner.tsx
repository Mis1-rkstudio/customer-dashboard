// src/components/Spinner.tsx
'use client';

import React from 'react';

export default function Spinner({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center p-6">
      <svg
        className="animate-spin"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <path
          d="M22 12a10 10 0 00-10-10"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// components/FilterDropdown.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";

type Props = {
  label?: string;
  placeholder?: string;
  options: string[];
  value: string[]; // selected values
  onChange: (next: string[]) => void;
  multi?: boolean; // multi-select (default true)
  maxVisibleTags?: number; // when >0 will collapse to "+N" if too many selected
  className?: string;
};

export default function FilterDropdown({
  label,
  placeholder = "Filter...",
  options,
  value,
  onChange,
  multi = true,
  maxVisibleTags = 3,
  className = "",
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleOption = (opt: string) => {
    if (!multi) {
      // single-select -> replace
      if (value.length === 1 && value[0] === opt) onChange([]);
      else onChange([opt]);
      setOpen(false);
      return;
    }
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };

  const clearAll = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange([]);
  };

  const displayText = () => {
    if (!value || value.length === 0) return placeholder;
    if (maxVisibleTags > 0 && value.length > maxVisibleTags) {
      return `${value.slice(0, maxVisibleTags).join(", ")} +${value.length - maxVisibleTags}`;
    }
    return value.join(", ");
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label ? <div className="text-xs text-slate-400 mb-1">{label}</div> : null}
      <div
        ref={inputRef}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((s) => !s)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((s) => !s);
          }
        }}
        className="w-full flex items-center justify-between gap-2 bg-[#07151a] border border-[#12202a] rounded-md px-3 py-2 cursor-pointer focus:outline-none"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <div className={`truncate text-sm ${value.length ? "text-white" : "text-slate-400"}`}>
          {displayText()}
        </div>

        <div className="flex items-center gap-2">
          {value.length > 0 ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={clearAll}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded focus:outline-none"
            >
              Clear
            </button>
          ) : null}

          <svg className="w-4 h-4 text-slate-300" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {open && (
        <div
          role="listbox"
          aria-multiselectable={multi}
          className="absolute left-0 right-0 mt-2 z-50 bg-[#07151a] border border-[#12202a] rounded-md shadow-lg max-h-56 overflow-auto"
        >
          <div className="p-2">
            {options.length === 0 ? (
              <div className="text-xs text-slate-500 p-2">No options</div>
            ) : (
              options.map((opt) => {
                const active = value.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOption(opt);
                    }}
                    className={`w-full text-left px-3 py-2 rounded hover:bg-[#0b1820] focus:outline-none flex items-center justify-between ${active ? "bg-[#0d2a3a]" : ""}`}
                  >
                    <div className="truncate text-sm text-slate-200">{opt}</div>
                    {multi ? (
                      <div className="ml-2 text-xs text-slate-300">
                        {active ? "✓" : ""}
                      </div>
                    ) : (
                      <div className="ml-2 text-xs text-slate-300">{active ? "●" : ""}</div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

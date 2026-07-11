"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type FilterSelectOption = {
  value: string;
  label: string;
};

type FilterSelectProps = {
  value: string;
  options: readonly FilterSelectOption[] | FilterSelectOption[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  id?: string;
};

export function FilterSelect({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  id,
}: FilterSelectProps) {
  const autoId = useId();
  const listId = id ?? autoId;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selected = options.find((o) => o.value === value) ?? options[0];
  const selectedIndex = options.findIndex((o) => o.value === value);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const selectAt = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt) return;
      onChange(opt.value);
      close();
    },
    [options, onChange, close],
  );

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = i < 0 ? 0 : Math.min(i + 1, options.length - 1);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = i < 0 ? options.length - 1 : Math.max(i - 1, 0);
        return next;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) selectAt(activeIndex);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    }
  };

  return (
    <div className="filter-select" ref={rootRef}>
      <button
        type="button"
        className="filter-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {selected?.label ?? value}
      </button>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          className="filter-select-menu"
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
          onKeyDown={onListKeyDown}
        >
          {options.map((opt, index) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                id={`${listId}-opt-${index}`}
                role="option"
                className="filter-select-option"
                data-index={index}
                data-active={activeIndex === index ? "true" : undefined}
                aria-selected={opt.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectAt(index)}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

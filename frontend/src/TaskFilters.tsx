import { useEffect, useRef, useState } from 'react';
import { isAllSelected } from './taskFilterUtils';
import type { FilterOption, FilterSelection } from './taskFilterUtils';

export function CheckboxFilter({
  label,
  ariaLabel,
  allLabel,
  options,
  selectedValues,
  onToggle,
  onToggleAll,
  disabled = false,
}: {
  label: string;
  ariaLabel: string;
  allLabel: string;
  options: FilterOption[];
  selectedValues: FilterSelection;
  onToggle: (value: string) => void;
  onToggleAll: () => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const allSelected = isAllSelected(options, selectedValues);
  const selectedLabel = allSelected
    ? allLabel
    : selectedValues?.length === 0
      ? 'None'
      : (selectedValues?.length ?? 0) > 1
      ? 'Multiple'
      : options.find((option) => option.value === selectedValues?.[0])?.label ?? 'None';

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  return (
    <div ref={filterRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-60"
      >
        {label}: {selectedLabel}
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 min-w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <div role="group" aria-label={`${label} options`} className="space-y-1">
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100">
              <input
                type="checkbox"
                aria-label={`${label}: All`}
                checked={allSelected}
                onChange={onToggleAll}
                className="accent-blue-600"
              />
              All
            </label>
            {options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">
                <input
                  type="checkbox"
                  aria-label={`${label}: ${option.label}`}
                  checked={selectedValues === null || selectedValues.includes(option.value)}
                  onChange={() => onToggle(option.value)}
                  className="accent-blue-600"
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

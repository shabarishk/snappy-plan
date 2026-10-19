export type FilterOption = {
  value: string;
  label: string;
};

export type FilterSelection = string[] | null;

export function isAllSelected(options: FilterOption[], selectedValues: FilterSelection) {
  return selectedValues === null
    || (options.length > 0 && options.every((option) => selectedValues.includes(option.value)));
}

export function toggleFilterOption(
  options: FilterOption[],
  selectedValues: FilterSelection,
  value: string
): string[] {
  if (selectedValues === null) {
    return options.filter((option) => option.value !== value).map((option) => option.value);
  }
  return selectedValues.includes(value)
    ? selectedValues.filter((selected) => selected !== value)
    : [...selectedValues, value];
}

export function toggleAllFilter(options: FilterOption[], selectedValues: FilterSelection): FilterSelection {
  return isAllSelected(options, selectedValues) ? [] : null;
}

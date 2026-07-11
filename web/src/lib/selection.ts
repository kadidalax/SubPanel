import { useCallback, useMemo, useState } from "react";

export function useSelection<T extends number | string = number>() {
  const [selected, setSelected] = useState<T[]>([]);

  const set = useCallback((ids: T[]) => {
    setSelected([...new Set(ids)]);
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const toggle = useCallback((id: T) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleAll = useCallback((ids: T[]) => {
    setSelected((prev) => {
      if (ids.length && ids.every((id) => prev.includes(id))) return prev.filter((id) => !ids.includes(id));
      return [...new Set([...prev, ...ids])];
    });
  }, []);

  const has = useCallback((id: T) => selected.includes(id), [selected]);

  const allSelected = useCallback((ids: T[]) => ids.length > 0 && ids.every((id) => selected.includes(id)), [selected]);

  return useMemo(
    () => ({ selected, set, clear, toggle, toggleAll, has, allSelected, count: selected.length }),
    [selected, set, clear, toggle, toggleAll, has, allSelected],
  );
}

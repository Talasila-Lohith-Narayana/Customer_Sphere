import { useCallback, useRef, useState } from "react";

export default function useAnalyticsRefresh() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [activePanelCount, setActivePanelCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const activeLoads = useRef(new Set());
  const refreshingRef = useRef(false);

  const handlePanelLoadingChange = useCallback((panelId, isLoading) => {
    if (isLoading) activeLoads.current.add(panelId);
    else activeLoads.current.delete(panelId);
    setActivePanelCount(activeLoads.current.size);
    if (!activeLoads.current.size && refreshingRef.current) {
      window.setTimeout(() => {
        if (!activeLoads.current.size) {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }, 0);
    }
  }, []);
  const handleLoaded = useCallback(() => setLastUpdated(new Date()), []);
  const refresh = useCallback(() => {
    if (refreshingRef.current || activeLoads.current.size) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshKey((key) => key + 1);
  }, []);

  return {
    panelProps: {
      refreshKey,
      onLoadStateChange: handlePanelLoadingChange,
      onLoaded: handleLoaded,
      preserveDataOnRefresh: true,
    },
    refreshing,
    disabled: activePanelCount > 0,
    lastUpdated,
    refresh,
  };
}

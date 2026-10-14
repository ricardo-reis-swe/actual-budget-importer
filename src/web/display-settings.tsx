import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

interface DisplaySettings {
  categoryPanel: boolean;
  setCategoryPanel(enabled: boolean): Promise<boolean>;
}

const DisplaySettingsContext = createContext<DisplaySettings | undefined>(undefined);

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [categoryPanel, setCategoryPanelState] = useState(false);

  useEffect(() => {
    void fetch('/api/settings')
      .then(async (response) => response.ok ? response.json() as Promise<{ categoryPanel?: boolean }> : undefined)
      .then((settings) => { if (settings) setCategoryPanelState(settings.categoryPanel === true); })
      .catch(() => undefined);
  }, []);

  const setCategoryPanel = async (enabled: boolean): Promise<boolean> => {
    const previous = categoryPanel;
    setCategoryPanelState(enabled);
    try {
      const response = await fetch('/api/settings/category-panel', {
        body: JSON.stringify({ enabled }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      if (!response.ok) {
        setCategoryPanelState(previous);
        return false;
      }
      return true;
    } catch {
      setCategoryPanelState(previous);
      return false;
    }
  };

  return <DisplaySettingsContext.Provider value={{ categoryPanel, setCategoryPanel }}>
    {children}
  </DisplaySettingsContext.Provider>;
}

export function useDisplaySettings(): DisplaySettings {
  return useContext(DisplaySettingsContext) ?? { categoryPanel: false, setCategoryPanel: async () => false };
}

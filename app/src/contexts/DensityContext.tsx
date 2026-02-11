import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type DensityMode = "minimal" | "normal" | "verbose";

interface DensityContextType {
  density: DensityMode;
  setDensity: (mode: DensityMode) => void;
  cycleDensity: () => void;
}

const DensityContext = createContext<DensityContextType>({
  density: "normal",
  setDensity: () => {},
  cycleDensity: () => {},
});

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<DensityMode>("normal");

  const cycleDensity = useCallback(() => {
    setDensity((prev) => {
      const modes: DensityMode[] = ["minimal", "normal", "verbose"];
      const idx = modes.indexOf(prev);
      return modes[(idx + 1) % modes.length];
    });
  }, []);

  // Keyboard shortcuts: Ctrl+1/2/3 for density modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey) return;
      switch (e.key) {
        case "1":
          e.preventDefault();
          setDensity("minimal");
          break;
        case "2":
          e.preventDefault();
          setDensity("normal");
          break;
        case "3":
          e.preventDefault();
          setDensity("verbose");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Apply density class to document
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  return (
    <DensityContext.Provider value={{ density, setDensity, cycleDensity }}>
      {children}
    </DensityContext.Provider>
  );
}

export function useDensity() {
  return useContext(DensityContext);
}

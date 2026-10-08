import { useEffect, useState } from "react";
import {
  CircleHelp,
  Focus,
  Frown,
  Glasses,
  Hexagon,
  Settings,
  Smile,
} from "lucide-react";
import Board from "./components/Board";
import HelpDialog from "./components/HelpDialog";
import SettingsDialog from "./components/SettingsDialog";
import type { SettingsSelection, Theme } from "./components/SettingsDialog";
import { useGame } from "./game/useGame";
import { useViewKeys } from "./game/useViewKeys";
import type { GameConfig } from "./game/useGame";
import { IDENTITY_ROTATION } from "./geometry/projection";
import type { Quaternion } from "./geometry/types";

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem("hemisweep-theme");
    return value === "paper" || value === "white" ? value : "dark";
  } catch {
    return "dark";
  }
}
function timeString(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export default function App() {
  const {
    mesh,
    game,
    frequency,
    density,
    pattern,
    adjacency,
    a,
    b,
    reset,
    reveal,
    flag,
    chord,
    flags,
    elapsed,
  } = useGame();
  const [rotation, setRotation] = useState<Quaternion>(IDENTITY_ROTATION);
  const [topology, setTopology] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useViewKeys(setRotation, !helpOpen && !settingsOpen);
  const config: GameConfig = { frequency, density, pattern, adjacency, a, b };
  const status =
    game.status === "won"
      ? "胜利"
      : game.status === "lost"
        ? "失败"
        : game.status === "playing"
          ? "进行中"
          : "未开始";
  const Face =
    game.status === "lost" ? Frown : game.status === "won" ? Glasses : Smile;
  function applySettings(selection: SettingsSelection) {
    setTheme(selection.theme);
    setTopology(selection.topology);
    const changed = (Object.keys(config) as (keyof GameConfig)[]).some(
      (key) => config[key] !== selection.config[key],
    );
    if (changed || selection.seed)
      reset({ ...selection.config, seed: selection.seed });
    setSettingsOpen(false);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        theme === "dark"
          ? "#101518"
          : theme === "paper"
            ? "#f2ecdc"
            : "#ffffff",
      );
    try {
      localStorage.setItem("hemisweep-theme", theme);
    } catch {
      /* Keep the theme usable without storage. */
    }
  }, [theme]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        (event.key.toLowerCase() !== "r" && event.key !== "F2") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        helpOpen ||
        settingsOpen
      )
        return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable)
        return;
      event.preventDefault();
      reset();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reset, helpOpen, settingsOpen]);
  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="#" className="brand" aria-label="HemiSweep 首页">
          <span className="brand-mark">
            <Hexagon size={23} strokeWidth={1.4} />
            <span />
          </span>
          <span>
            hemi<span className="brand-light">sweep</span>
          </span>
        </a>
        <div className="header-right">
          <button
            className="icon-button"
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={20} strokeWidth={1.6} />
          </button>
          <button
            className="icon-button"
            title="玩法说明"
            aria-label="玩法说明"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={20} strokeWidth={1.6} />
          </button>
        </div>
      </header>
      <main className="classic-game" aria-label="扫雷">
        <div className="classic-statusbar">
          <div className="classic-counter">
            <span
              className={
                game.mineCount - flags < 0
                  ? "counter-number over-flagged"
                  : "counter-number"
              }
              aria-label={`剩余地雷 ${game.mineCount - flags}`}
            >
              {(game.mineCount - flags).toString().padStart(3, "0")}
            </span>
            <span className="counter-caption">地雷</span>
          </div>
          <button
            className={`restart-button status-${game.status}`}
            onClick={() => reset()}
            aria-label="新棋局"
            title={
              game.status === "won" || game.status === "lost"
                ? `${status} · 新棋局`
                : "新棋局"
            }
          >
            <Face size={36} strokeWidth={1.5} />
          </button>
          <div className="classic-counter timer-counter">
            <span
              className="counter-number"
              aria-label={`用时 ${timeString(elapsed)}`}
            >
              {timeString(elapsed)}
            </span>
            <span className="counter-caption">用时</span>
          </div>
        </div>
        <div role="status" className="sr-only">
          {status}
        </div>
        <div className="board-wrap">
          <Board
            key={`${pattern}:${frequency}:${a}:${b}:${density}:${adjacency}:${game.seed}`}
            mesh={mesh}
            game={game}
            rotation={rotation}
            setRotation={setRotation}
            topology={topology}
            reveal={reveal}
            flag={flag}
            chord={chord}
          />
        </div>
        <div className="classic-board-actions">
          <button
            className="icon-button"
            aria-label="复位视角"
            title="复位视角"
            onClick={() => setRotation(IDENTITY_ROTATION)}
          >
            <Focus size={18} strokeWidth={1.5} />
          </button>
        </div>
      </main>
      {helpOpen && (
        <HelpDialog adjacency={adjacency} onClose={() => setHelpOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsDialog
          config={config}
          seed={game.seed}
          theme={theme}
          topology={topology}
          onApply={applySettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

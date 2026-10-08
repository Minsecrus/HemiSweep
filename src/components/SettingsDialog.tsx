import { useEffect, useRef, useState } from "react";
import { Moon, NotebookPen, Sun, X } from "lucide-react";
import { DENSITIES, SIZES } from "../game/useGame";
import type { BoardPattern, GameConfig } from "../game/useGame";
import { REGULAR_SYMBOLS } from "../geometry/regular";
import { cellCount } from "../geometry/tilings";
import type { AdjacencyRule } from "../geometry/adjacency";

export type Theme = "dark" | "paper" | "white";

export interface SettingsSelection {
  config: GameConfig;
  theme: Theme;
  topology: boolean;
  seed?: string;
}

interface SettingsDialogProps {
  config: GameConfig;
  theme: Theme;
  topology: boolean;
  seed: string;
  onApply: (selection: SettingsSelection) => void;
  onClose: () => void;
}

const THEMES = [
  { id: "dark", name: "深色", Icon: Moon },
  { id: "paper", name: "纸质", Icon: NotebookPen },
  { id: "white", name: "纯白", Icon: Sun },
] as const;

export default function SettingsDialog({
  config,
  theme,
  topology,
  seed,
  onApply,
  onClose,
}: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<GameConfig>({ ...config });
  const [themeDraft, setThemeDraft] = useState(theme);
  const [topologyDraft, setTopologyDraft] = useState(topology);
  const [seedDraft, setSeedDraft] = useState("");
  const regular = draft.pattern === "regular";
  const regularSymbol = REGULAR_SYMBOLS.find(
    (symbol) => symbol.a === draft.a && symbol.b === draft.b,
  );
  const count =
    draft.pattern === "regular"
      ? regularSymbol?.faces
      : cellCount(draft.frequency, draft.pattern);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  function updateConfig(changes: Partial<GameConfig>) {
    setDraft((previous) => ({ ...previous, ...changes }));
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="icon-button close-dialog"
        aria-label="关闭设置"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <h2 id="settings-title">设置</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply({
            config: draft,
            theme: themeDraft,
            topology: topologyDraft,
            seed: seedDraft.trim() || undefined,
          });
        }}
      >
        <div className="settings-group">
          <span className="field-label" id="size-label">
            规模
          </span>
          <div
            className="text-choices"
            role="group"
            aria-labelledby="size-label"
          >
            {SIZES.map((size) => {
              const selected = !regular && size.k === draft.frequency;
              return (
                <button
                  key={size.k}
                  type="button"
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() =>
                    updateConfig({
                      frequency: size.k,
                      pattern: regular ? "dual" : draft.pattern,
                    })
                  }
                >
                  {size.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-group">
          <span className="field-label" id="difficulty-label">
            难度
          </span>
          <div
            className="text-choices"
            role="group"
            aria-labelledby="difficulty-label"
          >
            {DENSITIES.map((difficulty) => (
              <button
                key={difficulty.value}
                type="button"
                className={difficulty.value === draft.density ? "selected" : ""}
                aria-pressed={difficulty.value === draft.density}
                title={`${Math.round(difficulty.value * 100)}% 地雷`}
                onClick={() => updateConfig({ density: difficulty.value })}
              >
                {difficulty.name}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <span className="field-label" id="appearance-label">
            外观
          </span>
          <div
            className="text-choices theme-choices"
            role="group"
            aria-labelledby="appearance-label"
          >
            {THEMES.map(({ id, name, Icon }) => (
              <button
                key={id}
                type="button"
                className={id === themeDraft ? "selected" : ""}
                aria-pressed={id === themeDraft}
                onClick={() => setThemeDraft(id)}
              >
                <Icon size={16} />
                {name}
              </button>
            ))}
          </div>
        </div>

        <details className="advanced-settings">
          <summary>高级</summary>
          <div className="advanced-body">
            <div className="settings-group">
              <label className="field-label" htmlFor="settings-pattern">
                网格
              </label>
              <select
                id="settings-pattern"
                value={draft.pattern}
                onChange={(event) =>
                  updateConfig({ pattern: event.target.value as BoardPattern })
                }
              >
                <option value="dual">五 / 六边形</option>
                <option value="triangular">三角形</option>
                <option value="quadrilateral">四边形</option>
                <option value="heptagonal">七边形混合</option>
                <option value="octagonal">八边形混合</option>
                <option value="regular">正则镶嵌 {"{a,b}"}</option>
              </select>
            </div>

            <div className="settings-group">
              <label className="field-label" htmlFor="settings-adjacency">
                邻接规则
              </label>
              <select
                id="settings-adjacency"
                value={draft.adjacency}
                onChange={(event) =>
                  updateConfig({ adjacency: event.target.value as AdjacencyRule })
                }
              >
                <option value="edge">共边</option>
                <option value="vertex">共边与共点</option>
              </select>
            </div>

            {regular ? (
              <>
                <div className="symbol-selectors">
                  <label>
                    <span className="field-label">a</span>
                    <select
                      aria-label="每面边数 a"
                      value={draft.a}
                      onChange={(event) => {
                        const nextA = Number(event.target.value);
                        const symbol =
                          REGULAR_SYMBOLS.find(
                            (option) =>
                              option.a === nextA && option.b === draft.b,
                          ) ??
                          REGULAR_SYMBOLS.find((option) => option.a === nextA)!;
                        updateConfig({ a: symbol.a, b: symbol.b });
                      }}
                    >
                      {[3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="field-label">b</span>
                    <select
                      aria-label="顶点处面数 b"
                      value={draft.b}
                      onChange={(event) =>
                        updateConfig({ b: Number(event.target.value) })
                      }
                    >
                      {[3, 4, 5].map((value) => (
                        <option
                          key={value}
                          value={value}
                          disabled={
                            !REGULAR_SYMBOLS.some(
                              (symbol) =>
                                symbol.a === draft.a && symbol.b === value,
                            )
                          }
                        >
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mesh-note">
                  {`{${draft.a},${draft.b}}`} · {count} 格
                </p>
              </>
            ) : (
              <>
                <div className="custom-size">
                  <label htmlFor="settings-frequency">细分 k</label>
                  <input
                    id="settings-frequency"
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={draft.frequency}
                    onChange={(event) =>
                      updateConfig({ frequency: Number(event.target.value) })
                    }
                  />
                  <output htmlFor="settings-frequency">
                    {draft.frequency}
                  </output>
                </div>
                <p className="mesh-note">{count} 格</p>
              </>
            )}

            <div className="settings-group">
              <label className="field-label" htmlFor="settings-seed">
                种子
              </label>
              <div className="seed-input">
                <input
                  id="settings-seed"
                  value={seedDraft}
                  placeholder="随机"
                  maxLength={80}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setSeedDraft(event.target.value)}
                />
                <button type="button" onClick={() => setSeedDraft(seed)}>
                  当前种子
                </button>
              </div>
            </div>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={topologyDraft}
                onChange={(event) => setTopologyDraft(event.target.checked)}
              />
              <span>对径辅助</span>
            </label>
          </div>
        </details>

        <div className="dialog-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="apply-button">
            确定
          </button>
        </div>
      </form>
    </dialog>
  );
}

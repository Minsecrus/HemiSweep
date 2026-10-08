import { useEffect, useRef } from "react";
import { Flag, MousePointer2, Move, X } from "lucide-react";

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        className="icon-button close-help"
        aria-label="关闭玩法说明"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <h2>玩法</h2>
      <div className="help-actions">
        <div>
          <MousePointer2 size={19} />
          <h3>翻开</h3>
          <p>
            找出全部安全格即可获胜。数字只统计共边邻居的地雷；空白自动展开。首击安全，格数允许时邻居也安全。
          </p>
        </div>
        <div>
          <Flag size={19} />
          <h3>插旗</h3>
          <p>
            右键或长按标记，再次操作取消。数字周围的旗数等于数字时，点击数字快速展开；标错可能触雷。
          </p>
        </div>
        <div>
          <Move size={19} />
          <h3>旋转</h3>
          <p>
            拖动或按住 WASD 改变视角。圆盘边界的对径点是同一个位置，两侧片段状态同步；旋转不改变棋局。
          </p>
        </div>
      </div>
      <button className="primary-button" onClick={onClose}>
        关闭
      </button>
    </dialog>
  );
}

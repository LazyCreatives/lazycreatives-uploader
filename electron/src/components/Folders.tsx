import { Icon } from "./Icon";
import { pickFolder } from "../api";
import { Button } from "./ui";
import { CopyButton, openMenu, toast } from "./Desktop";
import { baseName, copyText } from "../desktop";
import { revealPath } from "../api";

// Add/remove the folders the app watches for new renders. Shared by Setup + Settings.
export function Folders({ sources, onChange }: {
  sources: string[]; onChange: (s: string[]) => void;
}) {
  async function add() {
    const p = await pickFolder();
    if (p && !sources.includes(p)) onChange([...sources, p]);
  }
  function remove(s: string) {
    const before = sources;
    onChange(sources.filter((x) => x !== s));
    toast(`Stopped watching ${baseName(s)}.`, { label: "Undo", onClick: () => onChange(before) });
  }
  return (
    <div>
      <div className={sources.length ? "table" : ""} style={{ marginBottom: 10 }}>
        {sources.length === 0 && (
          <div className="sub" style={{ margin: 0 }}>No folders yet. Add the folder you export mixes into.</div>
        )}
        {sources.map((s) => (
          <div key={s} className="row" style={{ marginBottom: 0 }} onContextMenu={(e) => openMenu(e, [
            { label: "Show the folder", onClick: () => revealPath(s) },
            { label: "Copy folder path", onClick: () => { copyText(s); } },
            "-", { label: "Remove", onClick: () => remove(s), danger: true },
          ])}>
            <span className="faint" style={{ display: "flex" }}><Icon name="folder" /></span>
            <div className="row__main pathline"><div className="row__title mono col-trunc" style={{ fontSize: 12.5, fontWeight: 400 }} title={s}>{s}</div>
              <CopyButton text={s} what="folder path" size={13} /></div>
            <Button kind="quiet" sm onClick={() => remove(s)}>Remove</Button>
          </div>
        ))}
      </div>
      <Button onClick={add}><Icon name="plus" />Add folder</Button>
    </div>
  );
}

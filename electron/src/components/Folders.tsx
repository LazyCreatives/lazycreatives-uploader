import { Icon } from "./Icon";
import { pickFolder } from "../api";
import { Button } from "./ui";

// Add/remove the folders the app watches for new renders. Shared by Setup + Settings.
export function Folders({ sources, onChange }: {
  sources: string[]; onChange: (s: string[]) => void;
}) {
  async function add() {
    const p = await pickFolder();
    if (p && !sources.includes(p)) onChange([...sources, p]);
  }
  return (
    <div>
      <div className={sources.length ? "table" : ""} style={{ marginBottom: 10 }}>
        {sources.length === 0 && (
          <div className="sub" style={{ margin: 0 }}>No folders yet. Add the folder you export mixes into.</div>
        )}
        {sources.map((s) => (
          <div key={s} className="row" style={{ marginBottom: 0 }}>
            <span className="faint" style={{ display: "flex" }}><Icon name="folder" /></span>
            <div className="row__main"><div className="row__title mono" style={{ fontSize: 12.5, fontWeight: 400 }} title={s}>{s}</div></div>
            <Button kind="quiet" sm onClick={() => onChange(sources.filter((x) => x !== s))}>Remove</Button>
          </div>
        ))}
      </div>
      <Button onClick={add}><Icon name="plus" />Add folder</Button>
    </div>
  );
}

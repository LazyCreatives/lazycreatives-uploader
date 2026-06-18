import lockupUrl from "../assets/lazy-creatives-lockup.png";

// The Lazy Creatives lockup (headphone sloth + hand-lettered wordmark in Sloth Blue),
// shared with the Backups tool. `active` adds a soft working-glow while the app runs.
export function BrandLockup({ active = false }: { active?: boolean }) {
  return (
    <img
      className={`brandlockup${active ? " brandlockup--busy" : ""}`}
      src={lockupUrl}
      alt="Lazy Creatives"
      draggable={false}
    />
  );
}

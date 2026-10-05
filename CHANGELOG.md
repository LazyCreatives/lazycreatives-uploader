# What's new in LazyCreatives Uploader

Every version of the app, newest first, in plain words. The section for each
version is copied onto its download page automatically when it is released.

<!--
How to keep this up to date:
- Every change people will notice adds one line to the top section, saying what
  they will see or what now works, not how it was done.
- Put each line under New, Better or Fixed. Leave out headings with nothing under them.
- Until the first release, changes go under 0.1.0 below; on release day replace
  "not out yet" with the date. After that, start an "## Unreleased" section above
  it, and when the version is bumped rename it to "<version> (<day> <month> <year>)".
  The checks on pull requests fail if a new version has no section here.
-->

## 0.1.2 (5 October 2026)

### New
- **Right-click menus.** Right-click a track or mix for its everyday actions in one place: open it on SoundCloud, copy its link, edit it, make it public or private, show the file, or delete it. Works in both looks.
- **Keyboard shortcuts.** Cmd + F (Ctrl + F on Windows and Linux) jumps to the search box, Cmd + , (Ctrl + ,) opens Settings, Space plays or pauses the song in the player, and Esc closes the open panel. Help, Keyboard shortcuts lists them all.
- **A proper menu bar.** File, Edit, View, Window and Help menus, with the shortcuts listed next to each item, What's new, the website and Report a problem.
- **Drag and drop.** Drop a folder of mixes (or a mix) onto the window to add it to the folders Uploader watches.
- **Copy buttons.** One click copies a watched folder's path, or a track's SoundCloud link from its Edit panel.
- **Progress on the app icon.** While an upload runs, the dock (Mac) or taskbar (Windows) icon fills up to show how far it has got.

### Better
- **Settings save themselves.** Every change in Settings is saved straight away and a small "Saved" appears; there is no Save button to forget.
- **"Are you sure?" boxes that match the app.** Deleting a track from SoundCloud, or changing many at once, now asks in a box in the app's own look instead of the computer's grey pop-up.
- **Undo.** Removing a watched folder shows a short message with an Undo button.
- **Picks up where you left off.** The app reopens at the same size and place on screen, on the page you closed it on, with your sort order and filters as you left them.
- **Tray menu.** The tray / menu bar icon now reads "Open LazyCreatives Uploader" and "Quit LazyCreatives Uploader", the same in both apps.
- **See how each mix is doing while you post.** On the Upload page every mix shows Waiting, Uploading with its own bar, Posted, or Skipped (already on SoundCloud). Works in both looks.
- **A failed mix says why.** It shows the reason in red and a Try again button that posts just that mix. It stays ticked, so the next Post includes it.
- **Home tells you what's waiting.** When there are new mixes in your folder, Home says how many are ready to post and which one you exported last, with a Review and post button.
- **A friendlier welcome.** First-time setup now lets you pick your look straight away, and it now describes the steps in the order you do them: your folder first, then your SoundCloud account.
- **Friendlier empty pages.** When a list is empty or something goes wrong, the sloth shows up with a short line and a button for the next step.
- **Smoother and rounder.** Pages glide in, dropdowns match the app's look, covers settle into place one after another, and the Sleeve look has softer corners.

### Fixed
- **Logic Pro recordings stay out of your mixes.** If a watched folder holds Logic projects, the recordings inside them are no longer listed as mixes; your bounces still are.
- **Track names show at the normal window size.** On Your tracks, Upload and History the name column no longer shrinks to nothing when the window isn't very wide.
- **The tick box on a mix's cover no longer covers its catalogue number.** In the cover look on the Upload page it now sits in the top-left corner.

## 0.1.1 (5 October 2026)

### New
- **Back and forward with your mouse's side buttons.** The extra buttons on the side of a mouse now go back to the last page and forward again, like a web browser. On the keyboard it's Alt + left/right arrow on Windows and Linux, and Cmd + [ or ] on a Mac. Nothing happens while you're typing in a box.
- **Your tracks remembers where you were.** Go to another page and come back, or close a track's details, and the list is on the same page and scrolled to the same spot with the same search, filters and sort. The track you had open lights up for a moment. Works in both looks.

### Better
- **Runs on a newer app engine** with the latest security and speed fixes. Everything looks and works the same, and file pickers still open in the folder you last used. On a Mac it needs macOS 13 (Ventura) or newer.

### Fixed
- **The app icon now shows the Lazy Creatives logo** (the sloth, with a small upload arrow) in the installer, the Dock, the taskbar and the menu bar, instead of the old shield.

## 0.1.0 (4 October 2026)

### New
- **Post your mixes to SoundCloud without ever posting the same one twice.** The app knows what's already up, even when the same mix is saved in another format.
- **Your tracks**: edit, hide or delete the tracks already on your SoundCloud from one place.
- **Knows where each song came from.** If you use LazyCreatives Backups, each mix shows the project it was exported from, with its tempo and genre filled in.
- **Cover art made for you** from the song's sound, with lettering that looks the same on every computer.
- **Two looks, your choice**, the same as Backups: **Crate** (DJ-library rows with genre stripes and waveforms) or **Sleeve** (cover cards). A song has the same cover in both apps.
- **Play your mixes in the app** from a player bar at the bottom.
- **Check for updates yourself.** Settings shows which version you have and a **Check for updates** button that tells you straight away whether a newer one is out.
- **The app updates itself.** On Windows and Linux new versions download quietly and offer "Restart now" or "Later". On a Mac the app tells you a new version is out and takes you to the download page.
- **See what's new after an update.** The update message lists what changed in the new version, and the first time the app opens after updating it shows a short "What's new" list. Open it again any time from **What's new** in Settings.
- The update button says **Restart the app**, and the message makes clear that only the app restarts, never your computer.
- **Everything is unlocked** while the app is a free beta.
- Installers for Windows, Mac (Apple silicon) and Linux.

### Better
- Your SoundCloud login is locked away safely on Mac and Linux too, not just Windows.

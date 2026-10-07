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

## 0.2.2 (7 October 2026)

### New
- **Change a title before posting.** Pick Edit title… on a mix's ⋯ button (or double-click its name) on Upload, or click a title on the last look before posting, and type what it should be called on SoundCloud. Your file keeps its name.
- **Try again from History.** A failed post now has a Try again button (also on right-click) that posts it again with the same title and privacy. It only shows while that file hasn't gone up since.

### Better
- **A calmer, simpler look.** The Uploader now has one look, rows with waveforms, and the Crate/Sleeve switch is gone; on Your tracks, the new Covers button shows your tracks as album covers. Every screen shows less at once: posting choices sit under Post settings, filters under Filters, and mixes already on SoundCloud fold away. Upload ticks only mixes exported since your last post and shows when each was exported, newest first. Failed posts stand out in History, Home fits on one screen, and your collection figures moved to Your tracks. Row spacing and Preview on hover moved to Settings, under Lists. Change cover is now on each mix's ⋯ button, and "Show short files" is under Post settings.

### Fixed
- **Adding to a playlist works again.** Add to playlist stopped working after SoundCloud changed how apps must name tracks; it now adds the track and keeps everything already in the playlist, public or private.

## 0.2.1 (7 October 2026)

### New
- **Recently opened.** The last five tracks you opened sit in the sidebar under the menu, newest first, so you can jump back in with one click; Find anything (Ctrl+K / Cmd+K) lists them before you type. Right-click to take one off or clear the list. Kept on this computer only.
- **A bigger player.** Point at the cover in the player along the bottom and press the up arrow (or click the cover) to open a large Now playing view with a big cover, the waveform to scrub and the play button. The down arrow or Escape shrinks it back.
- **Your own cover art.** In Settings, under Covers, save as many pictures as you like and use each one behind the drawn cover or as the whole cover. Give pictures to genres, mix them across your mixes, or use one for everything, and pick Ink print, Photo or Label strip for how a picture sits behind the drawing. Your old default cover moves in here by itself.
- **Playlists.** A new Playlists page shows your SoundCloud playlists. Make one, add tracks (tick them in Your tracks and press Add to playlist, or add them from the playlist's own page), drag them into order and take them out. Every change goes to SoundCloud straight away.
- **Change cover** on any mix (right-click it, or Cover on its row) picks the drawn cover, any saved picture or a new one, with its own style. A cover picked in Backups shows here too.
- **Short exports stay out of the way.** Clicks, test bounces and one-shot renders shorter than 30 seconds are hidden on the Upload page and never posted automatically. Change the length or turn it off in Settings, under Watched folders; "Show short files" on Upload brings them back, and nothing is deleted.

### Better
- **Click a track's name in the player** to open that track's page.
- **Every mix goes up with the cover you see** on the Upload page, so nothing lands on SoundCloud as a grey square.

### Fixed
- **Automatic posting sends each song once.** When a song was exported as both WAV and MP3, the automatic folder check posted both. Now it posts only the best file of each song, and never a song already on SoundCloud in another format.
- **Mixes no longer post twice.** If the automatic folder check started while you pressed Post (or Post was pressed twice), every mix could go up two times. Now each mix is checked again right before it is sent, so it can only ever be posted once. And if SoundCloud takes a mix but its answer gets lost, the app now finds the track instead of calling it failed, so Try again doesn't post it a second time.
- **Nearly every audio file now plays** in the player: AIFF, Apple Lossless, WMA, AC-3, WavPack, CAF, 64-bit and compressed WAVs and more, where you used to see "Couldn't play this file". Your files are only read, never changed or copied.

## 0.2.0 (6 October 2026)

### New
- **Light mode.** Pick Dark, Light or Match my computer in Settings, under Look; both looks come in paper-light too.
- **A narrow window** that sits beside your music program: drop a mix on it to post it, watch it go up and see your latest posts, always on top if you like (View > Narrow window, or Ctrl+Shift+N / Cmd+Shift+N).
- **Right-click menus.** Right-click a post on Home to open it on SoundCloud, copy its link or see it in History. Text boxes get Cut, Copy, Paste and spelling fixes.
- **Point at the waveform** in the player to see the time, and drag to scrub through the mix.
- **Glass sidebar** on a Mac (frosted) and Windows 11 (tinted by your wallpaper). Older Windows and Linux stay solid.
- **Ctrl+1, 2, 3… (Cmd on a Mac)** jump to that page in the sidebar.
- **Rate your tracks** with one to five marks in Your tracks and from the right-click menu. Pick flames, hearts, records or dots in Settings, and sort by rating.
- **Crate colours.** Give any genre your own colour by right-clicking a track; every stripe and cover of that genre follows it.
- **Row height** in the Crate look's Your tracks and History: compact, comfortable or tall, remembered for next time.
- **History in Sleeve is your back catalogue:** every post as its cover, a shelf per month.
- **Smart crates.** Save any search and filters in Your tracks as a smart crate and show it again in one click.
- **Find anything with Ctrl+K (Cmd+K on a Mac)**, or the box under the app name: jump to a page, track, genre or smart crate, or post a mix, switch look and more.
- **Browse by Genre, then Year, then Track** in the Crate look's Your tracks (the columns button). In the Sleeve look the same choices sit over the covers as chips.
- **Your collection** at the bottom of Home: your tracks in figures, by genre and year, and your most played. In the Sleeve look it reads like a record's liner notes.
- **Filter by year posted and by rating** in Your tracks.
- **Preview on hover.** Switch it on in Upload or Your tracks, then point at a mix to hear a few seconds of it. Up and Down move through the list.
- **Comments on the waveform.** A track's page shows its SoundCloud comments as dots where listeners left them, with the newest three underneath, plus its plays and length.
- **A checklist before posting.** The last look now checks each mix's title, cover, genre, tags, file type and loudness, and says what is worth fixing first. Nothing stops you posting.
- **A bigger track page in the Sleeve look:** a large cover with the plays, length and comments printed big.

### Better
- **Calmer pop-up notes.** Up to three stack up instead of replacing each other, pointing at them holds them, and Home's numbers roll to their new value.
- **Smoother, quicker movement** across the app, and hover effects only with a mouse.
- **Long lists and big numbers fit.** Smaller windows drop the least needed columns instead of cutting off the right side, sizes go up to TB, a 4-hour set reads 4:02:03, BPM is rounded, numbers read 123,456 and "1 play" is singular.
- **A last look before posting.** Before several mixes (or anything public) go up, a short summary shows what will be posted, as Public or Private, and on which account.
- **Stop after this mix.** A running upload can now be stopped; the mix going up finishes and the rest wait.
- **Asks before throwing things away.** Disconnecting SoundCloud asks first and keeps you on Settings, removing a template can be undone, and closing Bulk edit with changes asks first.
- **Clearer lines between rows** in every list, in both looks, and dark, readable text on the orange SoundCloud button.
- **Same words everywhere.** "Draft" instead of "work in progress", the same Home labels in both looks, and the Upload list lines up with Your tracks (file type shown as a small tag).
- **Plainer headings, easier keyboard use, smoother long lists**, and dates that follow your computer's settings.
- **Home in Crate reads like a deck:** one big number for what's posted, with failed, waiting, ready and auto-upload listed underneath, next to your latest uploads.
- **Calmer covers.** Pointing at a cover slides it aside so its record peeks out, covers deal in once per session, and the glow behind Sleeve Home is gone.
- **Pop-ups and the edit panel fade out** when they close instead of vanishing in one frame.

### Fixed
- **The last look before posting sits in the middle again** in the Sleeve look; it had slipped down and could run off the bottom of the window.
- **A failed post's note shows a warning mark**, not a green tick.
- **Posting by hand now uses your default.** "Post as" starts on the default release you picked in Settings (it always started on Public), and your default tags are kept alongside the BPM tag.
- **"Go public later" can't post too early.** Ticking it fills in tomorrow at the same hour, an empty or past time stops the post, and the Post button says when the mixes go public.
- **Tags in Settings** can be typed normally again; commas and spaces no longer vanish.

## 0.1.4 (6 October 2026)

### Better
- **Easier Upload page.** A search box finds a mix by name, project or genre; a box in the Crate heading (or "Tick all" in Sleeve) ticks or unticks every new mix; mixes already on SoundCloud move under their own "Already on SoundCloud" heading and no longer offer "Mark draft". Both looks.
- **History by day.** Posts are grouped under Today, Yesterday and earlier days, with a search box, Posted/Failed/Skipped buttons with counts, and "Show older posts" once you have more than 100.
- **Better Edit track panel.** The track's cover, name and a play button head the panel, tags are separate chips you add with Enter and remove with a click, genre suggests the usual genres as you type, Ctrl+S (Cmd+S) saves, and closing with unsaved changes asks first.
- **Same words and times as Backups.** Music apps are called by their full names, times follow your computer's clock and say Today or Yesterday, and project details on Your tracks wrap onto a second line instead of being cut off.
- **A tidier top on Windows.** The white Windows title bar and the File / Edit / View menu row are gone; the app's own dark colour now runs right to the top, with Windows' minimise, maximise and close buttons on the right. The ☰ button at the top left opens the old menus. Dragging, snapping and double-click to maximise work as before. Both looks; Mac and Linux are unchanged.

## 0.1.3 (5 October 2026)

### New
- **Correct a mix's genre.** Genres you fix in Backups now show here too. To give one mix its own genre (say, a remix), right-click it on the Upload page or click its genre. Guessed genres have a dotted underline; ones you set don't. Works in both looks.
- **Your own genres.** Genres you type yourself stay at the top of the genre list.
- **Find any track on Your tracks.** The search box forgives typos and half-typed words and also looks at project names and music apps. New pickers narrow the list by music app, genre, tempo, project and search score, only offering what your own tracks have. The Public and Private buttons show how many tracks each would show, "Showing 2 of 8 tracks" has a Clear all button, and in the Crate look clicking a column heading sorts by it.

### Better
- **Follows songs renamed in Backups.** When you tidy a song's names in Backups, Uploader still knows which project each mix came from, still plays and outlines it, and still knows it's already on SoundCloud.
- **Matches mixes to projects more often.** Dates, tempo and key in a mix's name ("2026-10-01 Night Drive 124bpm Amin") no longer stop Uploader finding its project, the same way Backups now reads them.
- **Calmer screens in the Crate look.** The coloured stripe is kept for genres only: menus, pop-ups, the welcome box and the update panel no longer have a blue edge.
- **Sloth drawings that move.** "Nothing posted yet" now shows a sleepy sloth napping on a branch, and a search on Your tracks that finds nothing shows a sloth peering through a magnifying glass. Both sit still if you turn animations off in your computer's settings. Works in both looks.
- **A look of its own.** A new sturdy font and deep ink colours, covers made like printed record sleeves (the same as in Backups), level meters that move while a mix plays, slightly bigger small text, long project names that wrap instead of being cut off, and the sloth now says a word when a page is empty.

### Fixed
- **Signing in to SoundCloud on work or college networks.** Sign-in no longer fails with a "certificate verify failed" message on networks that check secure traffic; Uploader now trusts the same certificates as your computer.
- **Bitwig recordings stay out of your mixes.** Audio inside a Bitwig project folder (its samples, recordings and bounced clips) is no longer listed as a mix to upload; songs you export from Bitwig still are.

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

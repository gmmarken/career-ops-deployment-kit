---
description: Add something new about the user's work (a project, a result, a new role or title) to their CV and the files that check it, after a fact check and a read-back. Use it whenever the user tells you news about their job, even without the command.
---

The user is telling you something new about their work. Your job: get it right, show them, then update every file that carries their CV facts so packs and the base resume stay true. Their files live in `../private/` (outside this repo).

## Rules (they come before anything below)
- **Never invent facts.** Every number, title, date and claim must come from the user. Missing stays missing. Don't round up, and don't turn "we" into "I" or "I" into "we" without asking.
- **Nothing is written before the read-back is approved.** Show the exact new lines first.
- **Never write into this repo.** Only files under `../private/` change.
- **Confidential details stay out.** If the user's employer is sensitive, use the generic description they approve (for example "an internal analytics code repository", not the system's name). Ask when unsure.
- Never print contact details or key values.

## Steps

1. **Listen, then read what's there.** Read `../private/cv.md`, `../private/cv-projects.md`, `../private/config/cv-facts.json` and `../private/config/tailoring-rules.md`. Find the line(s) the news changes or adds to, and anything it contradicts.

2. **Ask the gap questions, in one batch.** Only ask what you can't answer from the files. Usually:
   - Is this new, or does it replace something already on the CV?
   - Is it finished, shipped or in use? (Don't claim work that isn't done or approved yet.)
   - The numbers: time saved, scale, people or users, before vs after. Which are measured and which are estimates?
   - Who is "we": the user alone, the user with an AI tool, or teammates? What part was the user's own?
   - Anything confidential, and how should it be named?
   - Did it come from a program, an award or a selection worth naming?

3. **Check it.** Compare the new facts with the CV and `cv-facts.json`: conflicting numbers or dates, a claim that overlaps a teammate's work, a word in `forbidden_phrases`, a CV line that gets too long. Say what you found.

4. **Read back.** Show, for each file, the line as it is now and the line you'd write:
   - `cv.md`: the bullet (keep the existing style: past-tense verb, one sentence or two, real numbers).
   - `cv-projects.md`: the notes section for that line (Project / What I did / Who I worked with / What I'd say in an interview).
   - `config/cv-facts.json`: new `allow_metrics` numbers, an `allow_facts` entry, any new `forbidden_phrases` (they match as substrings, so a short word like an acronym can block ordinary words; check before adding).
   - `config/tailoring-rules.md` or `config/keyword-bank.md`, if a rule or term names the old wording.
   - Also say what you're **not** claiming and why.
   Wait for the user's yes or corrections. Repeat until they approve.

5. **Back up, then write.** Copy the files you'll change to `../private/backups/cv-<short-name>-<YYYY-MM-DD>/` first. Then make the approved edits.

6. **Verify.**
   - `node scripts/check-setup.mjs`: the cv.md, profile and packs-config lines must pass.
   - `scripts/packs.sh notes`: every cv.md line has project notes.
   - `scripts/packs.sh cv-pdf`: rebuilds `../private/documents/cv.pdf` from cv.md, through the fact gate. Show the result line.
   - `node --test packs/packs.test.mjs`, if you touched anything the parser reads.

7. **Tell the user what didn't change.** Packs already built keep the old wording (`scripts/packs.sh status` lists them). New packs use the new line. Offer to rebuild a pack for any role they're about to apply to. Their own resume files and LinkedIn are theirs to update; give them the new line to paste.

8. **Interview story.** If the news makes a good interview story, say so under an **Interview story** heading, and follow the user's own instructions (CLAUDE.md) for where stories are saved.

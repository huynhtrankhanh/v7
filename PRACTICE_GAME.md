# Practice Game

The web app now includes a dedicated practice page at:

- `/practice/` (directory index)
- also reachable from `/practice` on most static servers

## Purpose

This page provides short, keyboard-only drills for learning V7 chords.

## Modes

1. **Partial syllable, left hand**
2. **Partial syllable, right hand**
3. **Partial syllable, random hand**
4. **Full syllable**

## Data source

The game uses the V7-to-syllable mapping loaded from `generated_regexes.json` via the server endpoint:

- `GET /practice/syllables`

This is treated as a one-to-many mapping from partial V7 code (for example `t_a_4`) to valid syllables.

## Gameplay rules

- A random syllable prompt is shown.
- The player enters the chord on a physical keyboard.
- **Wrong chords are not accepted**; the same prompt remains until a correct chord is entered.
- Partial modes require the `*` key (spacebar) to be part of the stroke.
- Each game lasts **60 seconds**.
- Score is number of correct prompts during that interval.

## Leaderboards

- Separate leaderboard per mode.
- Stored in browser `localStorage` under `v7.practice.<mode>`.
- Keeps top 10 scores per mode.
